import { expect, test } from "bun:test";
import { candidateToFact } from "../../src/ai/reduce";
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
