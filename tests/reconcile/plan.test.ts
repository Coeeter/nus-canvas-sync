import { expect, test } from "bun:test";
import { planReconciliation } from "../../src/reconcile/plan";
import { projectTask } from "../../src/rules/lifecycle";

test("manual rows are untouched and updates contain only agent-owned fields", () => {
  const manual = {
    id: "manual",
    automatedIdentity: null,
    properties: { Action: "Buy book", Notes: "mine", Priority: "High", Status: "In progress" },
  };
  const automatic = {
    id: "auto",
    automatedIdentity: "quiz:1",
    properties: { Action: "Keep title", Notes: "mine", Priority: "High", Status: "In progress" },
  };
  const projection = projectTask(
    {
      id: "quiz:1",
      courseCode: "IS1128",
      kind: "assessment",
      title: "Quiz 1",
      sourceIds: ["quiz:1"],
      observed: true,
      authoritativeAction: true,
    },
    new Date("2026-09-03T12:00:00+08:00"),
  );
  const operations = planReconciliation([manual, automatic], [projection], "2026-09-03T04:00:00Z");
  expect(operations).toHaveLength(1);
  expect(operations[0]?.type).toBe("update");
  expect(operations[0]?.properties).not.toHaveProperty("Action");
  expect(operations[0]?.properties).not.toHaveProperty("Notes");
  expect(operations[0]?.properties).not.toHaveProperty("Priority");
  expect(operations[0]?.properties).not.toHaveProperty("Status");
  expect(operations[0]?.properties["Canvas Item ID"]).toBe("quiz:1");
});

test("an unchanged automated projection produces no write", () => {
  const projection = projectTask(
    {
      id: "quiz:1",
      courseCode: "IS1128",
      kind: "assessment",
      title: "Quiz 1",
      sourceIds: ["quiz:1"],
      observed: true,
      authoritativeAction: true,
    },
    new Date("2026-09-03T12:00:00+08:00"),
  );
  const first = planReconciliation([], [projection], "2026-09-03T04:00:00Z")[0]!;
  expect(
    planReconciliation(
      [{ id: "page", automatedIdentity: "quiz:1", properties: first.properties }],
      [projection],
      "2026-09-03T04:00:00Z",
    ),
  ).toEqual([]);
});
