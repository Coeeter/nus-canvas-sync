import { expect, test } from "bun:test";
import { mergeCandidateFacts } from "../../src/ai/reduce";
import { validateCandidates } from "../../src/ai/validate";
import type { TaskFact } from "../../src/domain/task";
import { applyCourseSchedule } from "../../src/projector/schedule";
import { projectTask } from "../../src/rules/lifecycle";

const fact: TaskFact = {
  id: "course:97325:assignment:1",
  sourceIds: ["course:97325:assignment:1"],
  title: "Quiz",
  courseCode: "IS1128",
  kind: "assessment",
  observed: true,
  authoritativeAction: true,
};
test("lock and close evidence cannot fail open; date-only release is Singapore midnight", () => {
  const now = new Date("2026-09-05T01:00:00+08:00");
  expect(projectTask({ ...fact, lockedForUser: true }, now).state).toBe("locked");
  expect(projectTask({ ...fact, lockAt: "2026-09-04T00:00:00Z" }, now).state).toBe("locked");
  expect(projectTask({ ...fact, availableFrom: "2026-09-05" }, now).state).toBe("ready");
  expect(projectTask({ ...fact, availableFrom: "2026-02-30" }, now).state).toBe("review");
  expect(projectTask({ ...fact, availableFrom: "nonsense" }, now).state).toBe("review");
});

test("recess is excluded from teaching weeks and explicit source times win", () => {
  const prep: TaskFact = {
    ...fact,
    courseCode: "MA1301",
    kind: "preparation",
    title: "Week 7 preparation",
    sourceIds: ["course:97359:page:week-7"],
  };
  expect(applyCourseSchedule([prep])[0]?.eventEndsAt).toBe("2026-10-02T04:00:00.000Z");
  expect(
    applyCourseSchedule([
      { ...prep, availableFrom: "2026-09-01", eventEndsAt: "2026-10-01T04:00:00Z" },
    ])[0],
  ).toMatchObject({ availableFrom: "2026-09-01", eventEndsAt: "2026-10-01T04:00:00Z" });
});

test("candidate dates enrich normalized nulls and conflicting dates stay in Review", () => {
  const candidate = {
    courseCode: "IS1128" as const,
    sourceIds: fact.sourceIds,
    evidence: "Quiz closes on Friday",
    kind: "assessment" as const,
    title: "Quiz",
    requiredAction: "Attempt quiz",
    availableFrom: null,
    dueAt: "2026-09-11T15:59:00Z",
    eventEndsAt: null,
    confidence: 0.95,
    ambiguity: null,
  };
  expect(mergeCandidateFacts([{ ...fact, dueAt: null }], [candidate])[0]?.dueAt).toBe(
    candidate.dueAt,
  );
  expect(
    mergeCandidateFacts([{ ...fact, dueAt: "2026-09-12T15:59:00Z" }], [candidate])[0]?.conflict,
  ).toBeDefined();
  expect(() =>
    validateCandidates(
      { candidates: [{ ...candidate, dueAt: "invalid" }] },
      "IS1128",
      new Set(fact.sourceIds),
    ),
  ).toThrow();
  expect(() =>
    validateCandidates({ candidates: [candidate] }, "IS1128", new Set(fact.sourceIds), [
      {
        id: fact.id,
        courseCode: "IS1128",
        kind: "assignment",
        fields: { description: "Other evidence" },
        sourceUrl: null,
        contentHash: "x",
      },
    ]),
  ).toThrow("not a verbatim excerpt");
});
