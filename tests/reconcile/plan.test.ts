import { expect, test } from "bun:test";
import { planReconciliation, selectTrackedTasks } from "../../src/reconcile/plan";
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

test("canonical projections migrate an exact legacy numeric identity in place", () => {
  const projection = projectTask(
    {
      id: "course:94257:assignment:262076",
      courseCode: "GEA1000",
      kind: "assessment",
      title: "Quiz 2",
      sourceIds: ["course:94257:assignment:262076", "course:94257:quiz:86813"],
      observed: true,
      authoritativeAction: true,
    },
    new Date("2026-09-04T12:00:00+08:00"),
  );
  const [operation] = planReconciliation(
    [
      {
        id: "legacy-page",
        automatedIdentity: "262076",
        properties: {
          Status: "Done",
          Action: "Quiz 2",
          "Canvas Course ID": "94257",
          "Canvas Item Type": "assessment",
        },
      },
    ],
    [projection],
    "2026-09-04T04:00:00Z",
  );

  expect(operation).toMatchObject({ type: "update", pageId: "legacy-page" });
  expect(operation?.properties["Canvas Item ID"]).toBe("course:94257:assignment:262076");
  expect(operation?.properties).not.toHaveProperty("Status");
});

test("unscoped legacy names are not guessed from title words", () => {
  const projections = [
    projectTask(
      {
        id: "candidate:group",
        courseCode: "GESS1001",
        kind: "assessment",
        title: "Create GESS1001 group heritage project",
        sourceIds: ["course:94548:announcement:482225"],
        observed: true,
        authoritativeAction: true,
      },
      new Date(),
    ),
    projectTask(
      {
        id: "candidate:individual",
        courseCode: "GESS1001",
        kind: "assessment",
        title: "Write GESS1001 individual article",
        sourceIds: ["course:94548:announcement:482225"],
        observed: true,
        authoritativeAction: true,
      },
      new Date(),
    ),
  ];
  const operations = planReconciliation(
    [
      { id: "group", automatedIdentity: "482225", properties: {} },
      {
        id: "individual",
        automatedIdentity: "482225-individual-assignment",
        properties: {},
      },
    ],
    projections,
    "2026-09-04T04:00:00Z",
  );

  expect(operations.map((operation) => operation.type === "update" && operation.pageId)).toEqual([
    false,
    false,
  ]);
});

test("new rows are limited to ready or review work while existing history is retained", () => {
  const ready = projectTask(
    {
      id: "ready",
      courseCode: "IS1128",
      kind: "assessment",
      title: "Ready",
      sourceIds: ["ready"],
      observed: true,
      authoritativeAction: true,
    },
    new Date(),
  );
  const locked = projectTask(
    {
      id: "course:97325:assignment:2",
      courseCode: "IS1128",
      kind: "assessment",
      title: "Locked",
      sourceIds: ["course:97325:assignment:2"],
      observed: true,
      authoritativeAction: true,
      availableFrom: "2099-01-01T00:00:00Z",
    },
    new Date(),
  );

  expect(selectTrackedTasks([ready, locked], [])).toEqual([ready]);
  expect(
    selectTrackedTasks(
      [ready, locked],
      [
        {
          id: "old",
          automatedIdentity: "2",
          properties: {
            Status: "Waiting",
            "Canvas Course ID": "97325",
            "Canvas Item Type": "assessment",
          },
        },
      ],
    ),
  ).toEqual([ready, locked]);
});
