import { expect, test } from "bun:test";
import type { CourseCandidate } from "../../src/ai/types";
import { validateCandidates } from "../../src/ai/validate";
import type { NormalizedRecord } from "../../src/normalize/types";

test("candidate keys are unique across sources within the course and kind", () => {
  const records: Array<NormalizedRecord> = ["a", "b"].map((slug) => ({
    id: `course:97325:page:${slug}`,
    courseCode: "IS1128",
    kind: "page",
    sourceUrl: null,
    contentHash: slug,
    fields: { body: "Read the chapter." },
  }));
  const candidates = records.map(
    (record): CourseCandidate => ({
      courseCode: "IS1128",
      sourceIds: [record.id],
      actionKey: "read-chapter",
      evidence: "Read the chapter.",
      kind: "preparation",
      title: "Read chapter",
      requiredAction: "Read the chapter",
      availableFrom: null,
      dueAt: null,
      eventEndsAt: null,
      confidence: 1,
      ambiguity: null,
    }),
  );
  expect(() =>
    validateCandidates({ candidates }, "IS1128", new Set(records.map((r) => r.id)), records),
  ).toThrow("duplicate candidate action identity");
});

test("verbatim evidence survives harmless HTML boundaries around punctuation", () => {
  const record = {
    id: "course:93698:assignment:1",
    courseCode: "CS2030S",
    kind: "assignment",
    sourceUrl: null,
    contentHash: "hash",
    fields: { description: "<strong>Pen-and-paper assessment</strong>.&nbsp; Closed-book." },
  } satisfies NormalizedRecord;

  expect(() =>
    validateCandidates(
      {
        candidates: [
          {
            courseCode: "CS2030S",
            sourceIds: [record.id],
            evidence: "Pen-and-paper assessment.",
            actionKey: "quiz",
            relationship: "enrichment",
            kind: "assessment",
            title: "Quiz",
            requiredAction: "Attend the quiz",
            availableFrom: null,
            dueAt: null,
            eventEndsAt: null,
            confidence: 1,
            ambiguity: null,
          },
        ],
      },
      "CS2030S",
      new Set([record.id]),
      [record],
    ),
  ).not.toThrow();
});

test("plain-text generic notation cannot erase later evidence as if it were HTML", () => {
  const record = {
    id: "course:93698:document:1",
    courseCode: "CS2030S",
    kind: "document",
    sourceUrl: null,
    contentHash: "hash",
    fields: {
      text: "SubR <: R. You are expected to attempt them before coming to the recitation. > trailing",
    },
  } satisfies NormalizedRecord;
  const candidate = {
    courseCode: "CS2030S" as const,
    sourceIds: [record.id] as [string, ...Array<string>],
    evidence: "You are expected to attempt them before coming to the recitation.",
    actionKey: "problem-set",
    relationship: "action" as const,
    kind: "preparation" as const,
    title: "Problem set",
    requiredAction: "Attempt the problem set",
    availableFrom: null,
    dueAt: null,
    eventEndsAt: null,
    confidence: 1,
    ambiguity: null,
  };

  expect(() =>
    validateCandidates({ candidates: [candidate] }, "CS2030S", new Set([record.id]), [record]),
  ).not.toThrow();
});

test("a candidate evidenced only by its dedicated assessment must enrich that assessment", () => {
  const record = {
    id: "course:94257:assignment:262076",
    courseCode: "GEA1000",
    kind: "assignment",
    sourceUrl: null,
    contentHash: "hash",
    fields: { name: "Quiz 2", description: "Complete at least one attempt." },
  } satisfies NormalizedRecord;
  const candidate = {
    courseCode: "GEA1000" as const,
    sourceIds: [record.id] as [string, ...Array<string>],
    evidence: "Complete at least one attempt.",
    actionKey: "quiz-2",
    relationship: "action" as const,
    kind: "assessment" as const,
    title: "Quiz 2",
    requiredAction: "Complete Quiz 2",
    availableFrom: null,
    dueAt: null,
    eventEndsAt: null,
    confidence: 1,
    ambiguity: null,
  };

  expect(() =>
    validateCandidates({ candidates: [candidate] }, "GEA1000", new Set([record.id]), [record]),
  ).toThrow("relationship=enrichment");
});
