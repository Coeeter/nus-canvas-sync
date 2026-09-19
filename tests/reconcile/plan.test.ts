import { expect, test } from "bun:test";
import {
  findExistingAction,
  planReconciliation,
  selectTrackedTasks,
} from "../../src/reconcile/plan";
import { applyUserState, stateAfterVerifiedWrites } from "../../src/reconcile/state";
import { projectTask } from "../../src/rules/lifecycle";
import { emptyReconciliationState } from "../../src/state/reconcile-store";

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
  expect(
    operations[0]?.type === "update" && operations[0].expectedProperties["Canvas Item ID"],
  ).toBe("quiz:1");
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
        properties: { Status: "Done", Action: "Quiz 2" },
      },
    ],
    [projection],
    "2026-09-04T04:00:00Z",
  );

  expect(operation).toMatchObject({ type: "update", pageId: "legacy-page" });
  expect(operation?.properties["Canvas Item ID"]).toBe("course:94257:assignment:262076");
  expect(operation?.properties).not.toHaveProperty("Status");
});

test("legacy suffixed identities are matched by meaningful action words without reusing a row", () => {
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
    "group",
    "individual",
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
      [{ id: "old", automatedIdentity: "2", properties: { Status: "Waiting" } }],
    ),
  ).toEqual([ready, locked]);
});

test("unknown source fields are omitted while explicit null removes a value", () => {
  const unknown = projectTask(
    {
      id: "task:unknown",
      courseCode: "IS1128",
      kind: "assessment",
      title: "Unknown due",
      sourceIds: ["course:97325:announcement:9"],
      observed: true,
      authoritativeAction: true,
    },
    new Date("2026-09-03T12:00:00+08:00"),
  );
  const explicitRemoval = projectTask(
    { ...unknown, id: "task:removed", dueAt: null },
    new Date("2026-09-03T12:00:00+08:00"),
  );
  const existing = [
    {
      id: "page",
      automatedIdentity: "task:unknown",
      properties: {
        "Canvas Item ID": "task:unknown",
        "Official Due": "2026-09-20T00:00:00Z",
        Status: "Not started",
      },
    },
  ];
  const [unknownPatch] = planReconciliation(existing, [unknown], "2026-09-03T04:00:00Z");
  expect(unknownPatch?.type).toBe("update");
  expect(unknownPatch?.properties).not.toHaveProperty("Official Due");
  const [removalPatch] = planReconciliation(
    [{ ...existing[0]!, id: "removed", automatedIdentity: "task:removed" }],
    [explicitRemoval],
    "2026-09-03T04:00:00Z",
    {
      version: 1,
      tasks: {
        "task:removed": {
          logicalId: "task:removed",
          kind: "assessment",
          title: "Unknown due",
          aliases: [],
          sourceIds: ["course:97325:announcement:9"],
          sourceProposal: { "Official Due": "2026-09-20T00:00:00Z" },
          lastWritten: { "Official Due": "2026-09-20T00:00:00Z" },
        },
      },
    },
  );
  expect(removalPatch?.properties["Official Due"]).toBe(null);
  const [bootstrapNull] = planReconciliation(
    [{ ...existing[0]!, automatedIdentity: "task:removed" }],
    [explicitRemoval],
    "2026-09-03T04:00:00Z",
    emptyReconciliationState(),
  );
  expect(bootstrapNull?.properties["Official Due"]).toBeUndefined();
  expect(bootstrapNull?.properties["Needs Review"]).toBe(true);
});

test("an active bundle containing the projected members is reused", () => {
  const existing = [
    {
      id: "active-bundle",
      automatedIdentity: "bundle:GEA1000:old",
      properties: {
        "Canvas Item Type": "e-lecture",
        "Parent Canvas ID": "week-2\nweek-3\nweek-4\nweek-5\nweek-6",
        Status: "Not started",
      },
    },
  ];
  expect(
    findExistingAction(
      existing,
      "bundle:GEA1000:new",
      ["week-5", "week-6"],
      "Watch GEA1000 Weeks 5–6 lecture videos",
    )?.id,
  ).toBe("active-bundle");
});

test("bootstrap preserves a preexisting corrected due date and flags review", () => {
  const projection = projectTask(
    {
      id: "course:97325:assignment:123",
      courseCode: "IS1128",
      kind: "assessment",
      title: "Project",
      sourceIds: ["course:97325:assignment:123"],
      observed: true,
      authoritativeAction: true,
      dueAt: "2026-09-30T02:00:00Z",
    },
    new Date("2026-09-19T09:00:00Z"),
  );
  const row = {
    id: "page",
    automatedIdentity: projection.id,
    properties: {
      "Canvas Item ID": projection.id,
      "Official Due": "2026-10-01T02:00:00Z",
      Readiness: "Ready",
      "Needs Review": false,
      Status: "Not started",
    },
  };
  const [operation] = planReconciliation(
    [row],
    [projection],
    "2026-09-19T09:00:00.000Z",
    emptyReconciliationState(),
  );
  expect(operation?.type).toBe("update");
  expect(operation?.properties["Official Due"]).toBeUndefined();
  expect(operation?.properties["Needs Review"]).toBe(true);
  expect(operation?.properties.Readiness).toBe("Review");

  const saved = stateAfterVerifiedWrites(
    emptyReconciliationState(),
    [row],
    [projection],
    operation ? [operation] : [],
  );
  expect(saved.tasks[projection.id]?.lastWritten["Official Due"]).toBeUndefined();
  expect(saved.tasks[projection.id]?.protectedFields?.["Official Due"]).toBe(
    "2026-10-01T02:00:00.000Z",
  );

  const restarted = planReconciliation([row], [projection], "2026-09-20T09:00:00.000Z", saved);
  expect(restarted[0]?.properties["Official Due"]).toBeUndefined();
  const sourceChanged = { ...projection, dueAt: "2026-10-02T02:00:00Z" };
  const sourceChangedPlan = planReconciliation(
    [row],
    [sourceChanged],
    "2026-09-20T09:00:00.000Z",
    saved,
  );
  expect(sourceChangedPlan[0]?.properties["Official Due"]).toBeUndefined();
  expect(sourceChangedPlan[0]?.properties["Needs Review"]).toBe(true);
});

test("bootstrap correction survives restart, acceptance, and a later source change", () => {
  const fact = {
    id: "course:97325:assignment:123",
    courseCode: "IS1128" as const,
    kind: "assessment" as const,
    title: "Project",
    sourceIds: ["course:97325:assignment:123"],
    observed: true,
    authoritativeAction: true,
    dueAt: "2026-09-30T02:00:00Z",
  };
  const projection = projectTask(fact, new Date("2026-09-19T09:00:00Z"));
  const row = {
    id: "page",
    automatedIdentity: projection.id,
    properties: {
      "Canvas Item ID": projection.id,
      "Official Due": "2026-10-01T02:00:00Z",
      Readiness: "Ready",
      "Needs Review": false,
      Status: "Not started",
    },
  };
  const apply = (operation: ReturnType<typeof planReconciliation>[number]) => {
    if (operation.type === "update") Object.assign(row.properties, operation.properties);
    row.automatedIdentity = operation.identity;
    row.properties["Canvas Item ID"] = operation.identity;
  };

  const [initialOperation] = planReconciliation(
    [row],
    [projection],
    "2026-09-19T09:00:00.000Z",
    emptyReconciliationState(),
  );
  apply(initialOperation!);
  const initialState = stateAfterVerifiedWrites(
    emptyReconciliationState(),
    [row],
    [projection],
    [initialOperation!],
  );
  const restarted = projectTask(
    applyUserState(fact, row, initialState.tasks[fact.id]),
    new Date("2026-09-19T09:00:00Z"),
  );
  expect(restarted.dueAt).toBe("2026-10-01T02:00:00.000Z");
  expect(restarted.state).toBe("review");
  const restartOperations = planReconciliation(
    [row],
    [restarted],
    "2026-09-20T09:00:00.000Z",
    initialState,
  );
  expect(restartOperations[0]?.properties["Official Due"]).toBeUndefined();
  for (const operation of restartOperations) apply(operation);
  const reviewState = stateAfterVerifiedWrites(initialState, [row], [restarted], restartOperations);

  row.properties["Needs Review"] = false;
  row.properties.Readiness = "Review";
  const accepted = projectTask(
    applyUserState(fact, row, reviewState.tasks[fact.id]),
    new Date("2026-09-19T09:00:00Z"),
  );
  expect(accepted.dueAt).toBe("2026-10-01T02:00:00.000Z");
  expect(accepted.reviewResolution).toBeDefined();
  expect(accepted.state).toBe("ready");
  const acceptedOperations = planReconciliation(
    [row],
    [accepted],
    "2026-09-21T09:00:00.000Z",
    reviewState,
  );
  for (const operation of acceptedOperations) apply(operation);
  const acceptedState = stateAfterVerifiedWrites(
    reviewState,
    [row],
    [accepted],
    acceptedOperations,
  );

  const changed = projectTask(
    applyUserState({ ...fact, dueAt: "2026-10-02T02:00:00Z" }, row, acceptedState.tasks[fact.id]),
    new Date("2026-09-19T09:00:00Z"),
  );
  expect(changed.conflict).toBeDefined();
  expect(changed.state).toBe("review");
  const changedOperations = planReconciliation(
    [row],
    [changed],
    "2026-09-22T09:00:00.000Z",
    acceptedState,
  );
  expect(changedOperations[0]?.properties["Official Due"]).toBeUndefined();
  expect(changedOperations[0]?.properties["Needs Review"]).toBe(true);
});

test("an already-terminal planned row can migrate identity and completed metadata", () => {
  const projection = projectTask(
    {
      id: "course:97325:assignment:123",
      courseCode: "IS1128",
      kind: "assessment",
      title: "Project",
      sourceIds: ["course:97325:assignment:123"],
      aliases: ["legacy-task"],
      observed: true,
      authoritativeAction: true,
      userStatus: "Done",
    },
    new Date("2026-09-19T09:00:00Z"),
  );
  const [operation] = planReconciliation(
    [
      {
        id: "page",
        automatedIdentity: "legacy-task",
        properties: {
          "Canvas Item ID": "legacy-task",
          Status: "Done",
          Readiness: "Review",
          "Needs Review": true,
        },
      },
    ],
    [projection],
    "2026-09-19T09:00:00.000Z",
  );
  expect(operation).toMatchObject({ type: "update", pageId: "page" });
  expect(operation?.properties["Canvas Item ID"]).toBe(projection.id);
  expect(operation?.properties.Readiness).toBe("Completed");
  expect(operation?.properties["Needs Review"]).toBe(false);
  expect(operation?.type === "update" ? operation.expectedProperties.Status : undefined).toBe(
    "Done",
  );
});

test("a terminal row preserves a conflicting date without re-entering review", () => {
  const projection = projectTask(
    {
      id: "course:97325:assignment:123",
      courseCode: "IS1128",
      kind: "assessment",
      title: "Project",
      sourceIds: ["course:97325:assignment:123"],
      observed: true,
      authoritativeAction: true,
      dueAt: "2026-09-30T02:00:00Z",
      userStatus: "Done",
    },
    new Date("2026-09-19T09:00:00Z"),
  );
  const row = {
    id: "page",
    automatedIdentity: projection.id,
    properties: {
      "Canvas Item ID": projection.id,
      "Official Due": "2026-10-01T02:00:00Z",
      Status: "Done",
      Readiness: "Completed",
      "Needs Review": false,
    },
  };
  const [operation] = planReconciliation(
    [row],
    [projection],
    "2026-09-19T09:00:00.000Z",
    emptyReconciliationState(),
  );
  expect(operation?.type).toBe("update");
  expect(operation?.type === "update" ? operation.properties : {}).not.toHaveProperty(
    "Official Due",
  );
  expect(operation?.type === "update" ? operation.properties : {}).not.toHaveProperty(
    "Needs Review",
  );
  expect(operation?.type === "update" ? operation.properties : {}).not.toHaveProperty("Readiness");
});

test("ambiguous bundle overlap does not create a duplicate", () => {
  const projection = {
    id: "bundle:GEA1000:new",
    courseCode: "GEA1000" as const,
    kind: "e-lecture" as const,
    title: "Watch GEA1000 Weeks 5–7 lecture videos",
    sourceIds: ["module:5", "module:6", "module:7"],
    memberSourceIds: ["module:5", "module:6", "module:7"],
    observed: true,
    state: "ready" as const,
    actionable: true,
    needsReview: false,
    reason: null,
  };
  const operations = planReconciliation(
    [
      {
        id: "bundle-one",
        automatedIdentity: "bundle:GEA1000:one",
        properties: {
          "Canvas Item Type": "e-lecture",
          "Parent Canvas ID": "module:5\nmodule:6",
          Status: "Not started",
        },
      },
      {
        id: "bundle-two",
        automatedIdentity: "bundle:GEA1000:two",
        properties: {
          "Canvas Item Type": "e-lecture",
          "Parent Canvas ID": "module:7",
          Status: "Not started",
        },
      },
    ],
    [projection],
    "2026-09-19T09:00:00.000Z",
  );
  expect(operations).toEqual([]);
});
