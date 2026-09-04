import { expect, test } from "bun:test";
import type { TaskFact } from "../../src/domain/task";
import { applyCourseSchedule } from "../../src/projector/schedule";
import { projectTask } from "../../src/rules/lifecycle";

const preparation = (week: number): TaskFact => ({
  id: `week-${week}`,
  courseCode: "MA1301",
  kind: "preparation",
  title: `Week ${week} preparation`,
  sourceIds: [`course:97359:page:week-${week}`],
  observed: true,
});

test("MA1301 preparation is actionable only in its one-week runway", () => {
  const now = new Date("2026-09-04T13:23:38Z");
  const [week1, week5, week6] = applyCourseSchedule([
    preparation(1),
    preparation(5),
    preparation(6),
  ]);

  expect(projectTask(week1!, now).state).toBe("expired");
  expect(projectTask(week5!, now).state).toBe("ready");
  expect(projectTask(week6!, now).state).toBe("locked");
});

test("CS2030S problem-set preparation expires at its Wednesday recitation", () => {
  const now = new Date("2026-09-04T13:23:38Z");
  const facts: Array<TaskFact> = [2, 3, 4].map((number) => ({
    id: `problem-set-${number}`,
    courseCode: "CS2030S",
    kind: "preparation",
    title: `Prepare CS2030S Problem Set ${number} for recitation`,
    sourceIds: [`course:93698:document:${number}`],
    observed: true,
    week: number + 2,
  }));
  const [problemSet2, problemSet3, problemSet4] = applyCourseSchedule(facts);

  expect(projectTask(problemSet2!, now).state).toBe("expired");
  expect(projectTask(problemSet3!, now).state).toBe("ready");
  expect(projectTask(problemSet4!, now).state).toBe("locked");
  expect(problemSet3?.eventEndsAt).toBe("2026-09-09T07:00:00.000Z");
});
