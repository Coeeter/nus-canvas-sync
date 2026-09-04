import { expect, test } from "bun:test";
import { candidateToFact, mergeCandidateFacts } from "../../src/ai/reduce";
import type { CourseCandidate } from "../../src/ai/types";
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
