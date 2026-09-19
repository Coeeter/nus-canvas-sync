import { expect, test } from "bun:test";
import { candidateToFact, mergeCandidateFacts, taskMatchKey } from "../../src/ai/reduce";
import type { CourseCandidate } from "../../src/ai/types";
import { reviewRevision } from "../../src/reconcile/state";
import { projectTask } from "../../src/rules/lifecycle";

const candidate = (overrides: Partial<CourseCandidate>): CourseCandidate => ({
  courseCode: "IS1128",
  sourceIds: ["course:97325:announcement:1"],
  evidence: "weekly cadence",
  kind: "assessment",
  title: "Quiz 2",
  requiredAction: "Attempt",
  confidence: 0.95,
  ambiguity: null,
  ...overrides,
});

test("AI cadence text cannot release an assessment", () => {
  expect(projectTask(candidateToFact(candidate({})), new Date()).state).toBe("expected");
});

test("ambiguous or low-confidence candidates enter review", () => {
  expect(
    projectTask(candidateToFact(candidate({ ambiguity: "deadline conflict" })), new Date()).state,
  ).toBe("review");
});

test("structured review issues preserve affected values independently of prose", () => {
  const first = candidateToFact(
    candidate({
      ambiguity: "Sources disagree on deadline September 30 versus October 1",
      reviewIssue: {
        kind: "conflicting-deadline",
        fields: ["dueAt"],
        values: [
          {
            field: "dueAt",
            sourceId: "course:97325:announcement:1",
            state: "value",
            value: "2026-09-30",
          },
          {
            field: "dueAt",
            sourceId: "course:97325:announcement:2",
            state: "value",
            value: "2026-10-01",
          },
        ],
      },
    }),
  );
  const second = candidateToFact(
    candidate({
      ambiguity: "Sources disagree on deadline October 5 versus October 7",
      reviewIssue: {
        kind: "conflicting-deadline",
        fields: ["dueAt"],
        values: [
          {
            field: "dueAt",
            sourceId: "course:97325:announcement:1",
            state: "value",
            value: "2026-10-05",
          },
          {
            field: "dueAt",
            sourceId: "course:97325:announcement:2",
            state: "value",
            value: "2026-10-07",
          },
        ],
      },
    }),
  );
  expect(first.conflict?.issue).toBeDefined();
  expect(second.conflict?.issue).toBeDefined();
  expect(first.conflict?.issue?.values).not.toEqual(second.conflict?.issue?.values);
});

test("structured review issue fields are canonicalized as a set", () => {
  const values = [
    {
      field: "dueAt" as const,
      sourceId: "course:97325:announcement:1",
      state: "value" as const,
      value: "2026-09-30",
    },
  ];
  const first = candidateToFact(
    candidate({
      reviewIssue: {
        kind: "ambiguous-evidence",
        fields: ["eventEndsAt", "dueAt"],
        values,
      },
    }),
  );
  const reordered = candidateToFact(
    candidate({
      reviewIssue: {
        kind: "ambiguous-evidence",
        fields: ["dueAt", "eventEndsAt", "dueAt"],
        values,
      },
    }),
  );
  expect(first.conflict?.issue?.fields).toEqual(["dueAt", "eventEndsAt"]);
  expect(reordered.conflict?.issue?.fields).toEqual(["dueAt", "eventEndsAt"]);
  expect(reviewRevision(first)).toBe(reviewRevision(reordered));
});

test("date evidence distinguishes unknown from authoritative removal", () => {
  const base = {
    sourceIds: ["course:97325:announcement:1"],
    availableFrom: null,
    dueAt: null,
    eventEndsAt: null,
  };
  expect(
    candidateToFact(
      candidate({
        ...base,
        dateEvidence: {
          availableFrom: { state: "unknown", sourceIds: base.sourceIds },
          dueAt: { state: "unknown", sourceIds: base.sourceIds },
          eventEndsAt: { state: "unknown", sourceIds: base.sourceIds },
        },
      }),
    ),
  ).not.toHaveProperty("dueAt");
  expect(
    candidateToFact(
      candidate({
        ...base,
        dateEvidence: {
          availableFrom: { state: "unknown", sourceIds: base.sourceIds },
          dueAt: { state: "explicit-null", sourceIds: base.sourceIds },
          eventEndsAt: { state: "unknown", sourceIds: base.sourceIds },
        },
      }),
    ),
  ).toHaveProperty("dueAt", null);
});

test("AI evidence enriches an existing assessment instead of creating a second task", () => {
  const facts = mergeCandidateFacts(
    [
      {
        id: "course:94257:assignment:262076",
        courseCode: "GEA1000",
        kind: "assessment",
        title: "Quiz 2",
        sourceIds: ["course:94257:assignment:262076", "course:94257:quiz:86813"],
        observed: true,
        authoritativeAction: true,
      },
    ],
    [
      candidate({
        courseCode: "GEA1000",
        sourceIds: [
          "course:94257:announcement:487367",
          "course:94257:assignment:262076",
          "course:94257:quiz:86813",
        ],
        title: "Quiz 2",
        dueAt: "2026-09-06T15:59:00Z",
      }),
    ],
  );

  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({
    id: "course:94257:assignment:262076",
    dueAt: "2026-09-06T15:59:00Z",
  });
  expect(facts[0]?.sourceIds).toContain("course:94257:announcement:487367");
});

test("distinct actions from the same source set receive distinct derived identities", () => {
  const sourceIds = ["course:94548:announcement:482225", "course:94548:module:157036"];
  const group = candidateToFact(
    candidate({ courseCode: "GESS1001", sourceIds, title: "Create group video" }),
  );
  const individual = candidateToFact(
    candidate({ courseCode: "GESS1001", sourceIds, title: "Write individual article" }),
  );

  expect(group.id).not.toBe(individual.id);
});

test("quiz practice variants do not merge with the canonical quiz", () => {
  const canonical = candidateToFact(
    candidate({ courseCode: "GEA1000", title: "Quiz 3 (Chapter 3)" }),
  );
  const practice = candidateToFact(
    candidate({ courseCode: "GEA1000", title: "Quiz 3 (Practice)" }),
  );
  expect(canonical.id).not.toBe(practice.id);
  expect(
    mergeCandidateFacts(
      [],
      [
        candidate({ courseCode: "GEA1000", title: "Quiz 3 (Chapter 3)" }),
        candidate({ courseCode: "GEA1000", title: "Quiz 3 (Practice)" }),
      ],
    ),
  ).toHaveLength(2);
});

test("numbered quiz attempts remain distinct from the canonical quiz", () => {
  expect(taskMatchKey("Quiz 1 Attempt 2")).not.toBe(taskMatchKey("Quiz 1"));
  expect(taskMatchKey("Quiz 1 Attempt 2")).not.toBe(taskMatchKey("Quiz 1 Attempt 3"));
});

test("an assessed task and preparation stage may share an assignment source", () => {
  const assessment = {
    id: "course:97325:assignment:123",
    courseCode: "IS1128" as const,
    kind: "assessment" as const,
    title: "Submit the report",
    sourceIds: ["course:97325:assignment:123"],
    observed: true,
    authoritativeAction: true,
  };
  const preparation = candidate({
    kind: "preparation",
    title: "Prepare the report dataset",
    sourceIds: ["course:97325:assignment:123"],
    logicalKey: "source:course:97325:assignment:123#dataset",
  });
  const facts = mergeCandidateFacts([assessment], [preparation]);
  expect(facts).toHaveLength(2);
  expect(facts.map((fact) => fact.kind)).toEqual(["assessment", "preparation"]);
});

test("same-kind durable stages sharing an assignment remain distinct", () => {
  const proposal = {
    id: "course:97325:assignment:123",
    courseCode: "IS1128" as const,
    kind: "assessment" as const,
    title: "Project proposal",
    sourceIds: ["course:97325:assignment:123"],
    observed: true,
    authoritativeAction: true,
  };
  const report = candidate({
    title: "Final project report",
    sourceIds: ["course:97325:assignment:123"],
    logicalKey: "source:course:97325:assignment:123#report",
  });
  const facts = mergeCandidateFacts([proposal], [report]);
  expect(facts).toHaveLength(2);
  expect(facts.map((fact) => fact.logicalKey)).toContain(report.logicalKey ?? undefined);
});

test("multiple overlapping evidence sources do not silently drop unresolved work", () => {
  const facts = mergeCandidateFacts(
    [
      {
        id: "course:97325:assignment:123",
        courseCode: "IS1128",
        kind: "assessment",
        title: "Submit the report",
        sourceIds: ["course:97325:assignment:123"],
        observed: true,
        authoritativeAction: true,
      },
      {
        id: "course:97325:assignment:456",
        courseCode: "IS1128",
        kind: "assessment",
        title: "Submit the slides",
        sourceIds: ["course:97325:assignment:456"],
        observed: true,
        authoritativeAction: true,
      },
    ],
    [
      candidate({
        title: "Complete the project materials",
        sourceIds: ["course:97325:assignment:123", "course:97325:assignment:456"],
        logicalKey: "source:course:97325:assignment:123#materials",
      }),
    ],
  );
  expect(facts).toHaveLength(3);
});

test("AI does not add a second bundle over deterministic module lessons", () => {
  const facts = mergeCandidateFacts(
    [1, 2].map((week) => ({
      id: `course:94257:module:${week}:item:${week}`,
      courseCode: "GEA1000" as const,
      kind: "e-lecture" as const,
      title: `Week ${week}`,
      sourceIds: [`course:94257:module:${week}:item:${week}`],
      observed: true,
      week,
    })),
    [
      candidate({
        courseCode: "GEA1000",
        kind: "e-lecture",
        title: "Watch Weeks 1–2 videos",
        sourceIds: ["course:94257:module:1", "course:94257:module:2"],
      }),
    ],
  );

  expect(facts).toHaveLength(2);
});

test("model uncertainty cannot turn a deterministic source-backed fact into review", () => {
  const facts = mergeCandidateFacts(
    [
      {
        id: "course:94257:announcement:485604",
        courseCode: "GEA1000" as const,
        kind: "preparation" as const,
        title: "Prepare GEA1000 Tutorial 2 questions",
        sourceIds: ["course:94257:announcement:485604"],
        observed: true,
      },
    ],
    [
      candidate({
        courseCode: "GEA1000",
        title: "Review Tutorial 2 instructions",
        sourceIds: ["course:94257:announcement:485604"],
        ambiguity: "Maybe this is only informational",
        confidence: 0.5,
      }),
    ],
  );

  expect(facts).toHaveLength(1);
  expect(facts[0]?.conflict).toBeUndefined();
  expect(facts[0]?.title).toBe("Prepare GEA1000 Tutorial 2 questions");
});
