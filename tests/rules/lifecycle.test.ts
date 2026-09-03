import { describe, expect, test } from "bun:test";
import type { TaskFact } from "../../src/domain/task";
import { cs2030sExerciseCompleted, projectTask } from "../../src/rules/lifecycle";

const now = new Date("2026-09-03T12:00:00+08:00");
const fact = (overrides: Partial<TaskFact>): TaskFact => ({
  id: "test",
  courseCode: "IS1128",
  kind: "assessment",
  title: "Quiz 2",
  sourceIds: ["schedule"],
  observed: true,
  authoritativeAction: true,
  ...overrides,
});

describe("deterministic lifecycle", () => {
  test("an unreleased IS1128 cadence item remains expected and inactive", () => {
    expect(projectTask(fact({ observed: false, authoritativeAction: false }), now).state).toBe(
      "expected",
    );
  });
  test("a future unlock is locked", () => {
    expect(projectTask(fact({ availableFrom: "2026-09-05T00:00:00+08:00" }), now).state).toBe(
      "locked",
    );
  });
  test("completion and user terminal choices are sticky", () => {
    expect(projectTask(fact({ completed: true }), now).state).toBe("done");
    expect(projectTask(fact({ userStatus: "Done" }), now).state).toBe("done");
    expect(projectTask(fact({ userStatus: "Dropped" }), now).state).toBe("inactive");
  });
  test("physical labs and lectures do not become todos", () => {
    expect(
      projectTask(fact({ kind: "physical-event", title: "Sit-In Lab 2" }), now).actionable,
    ).toBe(false);
    expect(projectTask(fact({ kind: "e-lecture", courseCode: "CS2030S" }), now).state).toBe(
      "inactive",
    );
  });
  test("past preparation expires and optional diagnostics remain inactive", () => {
    expect(
      projectTask(fact({ kind: "preparation", eventEndsAt: "2026-09-02T15:00:00+08:00" }), now)
        .state,
    ).toBe("expired");
    expect(
      projectTask(fact({ kind: "optional", title: "Practice Diagnostic 02" }), now).state,
    ).toBe("inactive");
  });
  test("conflicting GESS1001 deadlines go to review", () => {
    expect(
      projectTask(
        fact({
          courseCode: "GESS1001",
          conflict: { reason: "Two official deadlines disagree", sources: ["brief", "syllabus"] },
        }),
        now,
      ).state,
    ).toBe("review");
  });
  test("only an exact latest Submit commit completes a CS2030S exercise", () => {
    expect(cs2030sExerciseCompleted("Submit")).toBe(true);
    expect(cs2030sExerciseCompleted("submit")).toBe(false);
    expect(cs2030sExerciseCompleted("Submit exercise")).toBe(false);
  });
});
