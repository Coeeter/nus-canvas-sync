import { expect, test } from "bun:test";
import type { TaskFact } from "../../src/domain/task";
import { bundleContiguousLectures } from "../../src/projector/bundle";
import { projectTask } from "../../src/rules/lifecycle";

test("contiguous GEA1000 e-lectures form one stable work-session bundle", () => {
  const tasks = [1, 2, 3].map((week) =>
    projectTask(
      {
        id: `week-${week}`,
        courseCode: "GEA1000",
        kind: "e-lecture",
        title: `Week ${week}`,
        sourceIds: [`module:${week}`],
        observed: true,
        week,
      } satisfies TaskFact,
      new Date("2026-09-03T12:00:00+08:00"),
    ),
  );
  const [bundle] = bundleContiguousLectures(tasks);
  expect(bundle?.title).toBe("Watch GEA1000 Weeks 1–3 lecture videos");
  expect(bundle?.memberSourceIds).toEqual(["module:1", "module:2", "module:3"]);
  expect(bundle?.actionable).toBe(true);
});
