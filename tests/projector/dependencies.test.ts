import { expect, test } from "bun:test";
import type { TaskFact } from "../../src/domain/task";
import { applyTaskDependencies } from "../../src/projector/dependencies";
import { projectTask } from "../../src/rules/lifecycle";

const diagnostic = (number: number, overrides: Partial<TaskFact> = {}): TaskFact => ({
  id: `diagnostic-${number}`,
  courseCode: "CS2030S",
  kind: "assessment",
  title: `Diagnostic ${String(number).padStart(2, "0")}`,
  sourceIds: [`diagnostic-${number}`],
  observed: true,
  authoritativeAction: true,
  ...overrides,
});

test("diagnostic dependencies wait only on the immediate unfinished prerequisite", () => {
  const waiting = applyTaskDependencies([
    diagnostic(5),
    diagnostic(6, { availableFrom: "2026-09-14T06:00:00Z" }),
  ]);
  expect(waiting[1]?.blockedBy).toBe("Diagnostic 05");
  expect(projectTask(waiting[1]!, new Date("2026-09-04T00:00:00Z")).state).toBe("waiting");

  const cleared = applyTaskDependencies([
    diagnostic(5, { userStatus: "Done" }),
    diagnostic(6, { availableFrom: "2026-09-14T06:00:00Z" }),
  ]);
  expect(cleared[1]?.blockedBy).toBeNull();
  expect(projectTask(cleared[1]!, new Date("2026-09-04T00:00:00Z")).state).toBe("locked");
});
