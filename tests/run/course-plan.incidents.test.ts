import { expect, test } from "bun:test";
import { candidateToFact } from "../../src/ai/reduce";
import type { CandidateEnvelope, CourseCandidate } from "../../src/ai/types";
import type { ExistingAction } from "../../src/reconcile/plan";
import { stateAfterVerifiedWrites } from "../../src/reconcile/state";
import { planCourse } from "../../src/run/course-plan";
import { emptyReconciliationState } from "../../src/state/reconcile-store";

const fixture = await Bun.file("tests/fixtures/incidents/notion-reconciliation.json").json();
const now = new Date("2026-09-19T09:00:00Z");

function existing(): Array<ExistingAction> {
  return structuredClone(fixture.existing) as Array<ExistingAction>;
}

function course(code: "IS1128" | "GEA1000", rows = existing(), candidates?: CandidateEnvelope) {
  const source = fixture.courses[code];
  return planCourse({
    records: source.records,
    candidates: candidates ?? { candidates: source.candidates },
    existing: rows,
    reconciliationState: emptyReconciliationState(),
    now,
    syncedAt: now.toISOString(),
  });
}

function applyVerified(
  rows: Array<ExistingAction>,
  operations: ReadonlyArray<ReturnType<typeof course>["operations"][number]>,
) {
  for (const operation of operations) {
    if (operation.type === "create") {
      rows.push({
        id: `created-${rows.length}`,
        automatedIdentity: operation.identity,
        properties: { ...operation.properties },
      });
      continue;
    }
    const row = rows.find((candidate) => candidate.id === operation.pageId)!;
    Object.assign(row.properties, operation.properties);
    row.automatedIdentity = operation.identity;
    row.properties["Canvas Item ID"] = operation.identity;
  }
}

test("captured IS1128 proposal and GEA1000 Quiz 3 incidents reduce through the shared plan", () => {
  const proposal = course("IS1128").projections.filter((task) => /proposal/i.test(task.title));
  const quiz = course("GEA1000").projections.filter((task) => /^quiz 3/i.test(task.title));
  expect(proposal).toHaveLength(1);
  expect(proposal[0]?.id).toBe("course:97325:assignment:274462");
  expect(proposal[0]?.state).toBe("done");
  expect(quiz).toHaveLength(1);
  expect(quiz[0]?.id).toBe("course:94257:assignment:262075");
});

test("review acceptance, restart and a later conflict use persisted state", () => {
  const rows = existing();
  const tutorial = rows.find((row) => row.id === "tutorial-3")!;
  tutorial.properties["Needs Review"] = false;
  tutorial.properties["Official Due"] = "2026-09-30T02:00:00Z";
  tutorial.properties.Readiness = "Review";
  const accepted = course("GEA1000", rows);
  const acceptedTask = accepted.projections.find(
    (task) => task.title === "Prepare Tutorial 3 questions",
  )!;
  expect(acceptedTask.state).toBe("ready");
  expect(acceptedTask.dueAt).toBe("2026-09-30T02:00:00.000Z");
  expect(
    accepted.operations.some(
      (operation) => operation.type === "update" && operation.properties["Needs Review"] === true,
    ),
  ).toBe(false);

  applyVerified(rows, accepted.operations);
  const acceptedState = stateAfterVerifiedWrites(
    emptyReconciliationState(),
    rows,
    accepted.projections,
    accepted.operations,
  );
  const restarted = planCourse({
    records: fixture.courses.GEA1000.records,
    candidates: { candidates: fixture.courses.GEA1000.candidates },
    existing: rows,
    reconciliationState: acceptedState,
    now,
    syncedAt: now.toISOString(),
  });
  expect(
    restarted.projections.filter((task) => task.title === "Prepare Tutorial 3 questions"),
  ).toHaveLength(1);
  expect(
    restarted.projections.find((task) => task.title === "Prepare Tutorial 3 questions")?.state,
  ).toBe("ready");

  const changed = structuredClone(fixture.courses.GEA1000.candidates) as Array<CourseCandidate>;
  const tutorialCandidate = changed.find(
    (candidate) => candidate.title === "Prepare Tutorial 3 questions",
  )!;
  tutorialCandidate.ambiguity = "A new source gives a conflicting class date";
  tutorialCandidate.sourceIds = [
    ...tutorialCandidate.sourceIds,
    "course:94257:announcement:999999",
  ];
  const conflict = planCourse({
    records: fixture.courses.GEA1000.records,
    candidates: { candidates: changed },
    existing: rows,
    reconciliationState: acceptedState,
    now,
    syncedAt: now.toISOString(),
  });
  expect(
    conflict.projections.find((task) => task.title === "Prepare Tutorial 3 questions")?.state,
  ).toBe("review");
  const conflictPatch = conflict.operations.find(
    (operation) => operation.type === "update" && operation.pageId === "tutorial-3",
  );
  expect(conflictPatch?.properties["Needs Review"]).toBe(true);
  expect(conflictPatch?.properties["Official Due"]).not.toBe(null);
});

test("accepted Tutorial 3 review survives an added reminder source", () => {
  const rows = existing();
  const tutorial = rows.find((row) => row.id === "tutorial-3")!;
  tutorial.properties["Needs Review"] = false;
  tutorial.properties["Official Due"] = "2026-09-30T02:00:00Z";
  tutorial.properties.Readiness = "Review";
  const accepted = course("GEA1000", rows);
  applyVerified(rows, accepted.operations);
  const acceptedState = stateAfterVerifiedWrites(
    emptyReconciliationState(),
    rows,
    accepted.projections,
    accepted.operations,
  );
  const unchangedIssue = structuredClone(
    fixture.courses.GEA1000.candidates,
  ) as Array<CourseCandidate>;
  const tutorialCandidate = unchangedIssue.find(
    (candidate) => candidate.title === "Prepare Tutorial 3 questions",
  )!;
  tutorialCandidate.sourceIds = [
    ...tutorialCandidate.sourceIds,
    "course:94257:announcement:999999",
  ];
  const afterReminder = planCourse({
    records: fixture.courses.GEA1000.records,
    candidates: { candidates: unchangedIssue },
    existing: rows,
    reconciliationState: acceptedState,
    now,
    syncedAt: now.toISOString(),
  });
  const task = afterReminder.projections.find(
    (projection) => projection.title === "Prepare Tutorial 3 questions",
  );
  expect(task?.state).toBe("ready");
  expect(task?.needsReview).toBe(false);
  expect(task?.dueAt).toBe("2026-09-30T02:00:00.000Z");
  expect(
    afterReminder.operations.some(
      (operation) => operation.type === "update" && operation.properties["Needs Review"] === true,
    ),
  ).toBe(false);
});

test("a pending review captures the user's correction when it is accepted on the next run", () => {
  const rows = existing();
  const initial = course("GEA1000", rows);
  const pendingState = stateAfterVerifiedWrites(
    emptyReconciliationState(),
    rows,
    initial.projections,
    initial.operations,
  );
  const tutorial = rows.find((row) => row.id === "tutorial-3")!;
  tutorial.properties["Needs Review"] = false;
  tutorial.properties["Official Due"] = "2026-09-30T02:00:00Z";
  const accepted = planCourse({
    records: fixture.courses.GEA1000.records,
    candidates: { candidates: fixture.courses.GEA1000.candidates },
    existing: rows,
    reconciliationState: pendingState,
    now,
    syncedAt: now.toISOString(),
  });
  const task = accepted.projections.find(
    (projection) => projection.title === "Prepare Tutorial 3 questions",
  );
  expect(task?.state).toBe("ready");
  expect(task?.dueAt).toBe("2026-09-30T02:00:00.000Z");

  const acceptedState = stateAfterVerifiedWrites(
    pendingState,
    rows,
    accepted.projections,
    accepted.operations,
  );
  tutorial.properties["Official Due"] = null;
  const cleared = planCourse({
    records: fixture.courses.GEA1000.records,
    candidates: { candidates: fixture.courses.GEA1000.candidates },
    existing: rows,
    reconciliationState: acceptedState,
    now,
    syncedAt: now.toISOString(),
  });
  const clearedTask = cleared.projections.find(
    (projection) => projection.title === "Prepare Tutorial 3 questions",
  );
  expect(clearedTask?.state).toBe("ready");
  expect(clearedTask?.dueAt).toBe(null);
});

test("a later derived stage with the same source keeps a persisted stage distinct", () => {
  const proposal: CourseCandidate = {
    courseCode: "IS1128",
    sourceIds: ["course:97325:announcement:500"],
    evidence: "proposal",
    kind: "assessment",
    title: "Project proposal",
    requiredAction: "Submit proposal",
    dueAt: "2026-09-20T15:59:59Z",
    confidence: 0.95,
    ambiguity: null,
    matchTaskId: null,
    logicalKey: "source:course:97325:announcement:500#proposal",
  };
  const report = {
    ...proposal,
    title: "Final project report",
    logicalKey: "source:course:97325:announcement:500#report",
  };
  const rows: Array<ExistingAction> = [];
  const first = planCourse({
    records: [],
    candidates: { candidates: [proposal] },
    existing: rows,
    reconciliationState: emptyReconciliationState(),
    now,
    syncedAt: now.toISOString(),
  });
  applyVerified(rows, first.operations);
  const persisted = stateAfterVerifiedWrites(
    emptyReconciliationState(),
    rows,
    first.projections,
    first.operations,
  );
  const second = planCourse({
    records: [],
    candidates: { candidates: [report] },
    existing: rows,
    reconciliationState: persisted,
    now,
    syncedAt: now.toISOString(),
  });
  expect(second.projections.map((projection) => projection.logicalKey)).toEqual([
    report.logicalKey,
  ]);
  expect(second.operations[0]?.type).toBe("create");
});

test("a persisted source-ID alias cannot absorb a later durable stage", () => {
  const sharedSource = "course:97325:announcement:500";
  const proposal: CourseCandidate = {
    courseCode: "IS1128",
    sourceIds: [sharedSource],
    evidence: "proposal",
    kind: "assessment",
    title: "Project proposal",
    requiredAction: "Submit proposal",
    dueAt: "2026-09-20T15:59:59Z",
    confidence: 0.95,
    ambiguity: null,
    matchTaskId: null,
    logicalKey: `source:${sharedSource}#proposal`,
  };
  const report = {
    ...proposal,
    title: "Final project report",
    logicalKey: `source:${sharedSource}#report`,
  };
  const rows: Array<ExistingAction> = [];
  const first = planCourse({
    records: [],
    candidates: { candidates: [proposal] },
    existing: rows,
    reconciliationState: emptyReconciliationState(),
    now,
    syncedAt: now.toISOString(),
  });
  applyVerified(rows, first.operations);
  const persisted = stateAfterVerifiedWrites(
    emptyReconciliationState(),
    rows,
    first.projections,
    first.operations,
  );
  rows[0]!.automatedIdentity = sharedSource;
  rows[0]!.properties["Canvas Item ID"] = sharedSource;

  const second = planCourse({
    records: [],
    candidates: { candidates: [report] },
    existing: rows,
    reconciliationState: persisted,
    now,
    syncedAt: now.toISOString(),
  });
  expect(second.projections.map((projection) => projection.logicalKey)).toEqual([
    report.logicalKey,
  ]);
  expect(second.operations[0]?.type).toBe("create");
});

test("title/evidence changes keep canonical identity and distinct staged work survives", () => {
  const changed = structuredClone(fixture.courses.GEA1000.candidates) as Array<CourseCandidate>;
  const reminder = changed.find((candidate) => candidate.title === "Quiz 3")!;
  reminder.title = "Complete Quiz 3";
  reminder.sourceIds = [...reminder.sourceIds, "course:94257:announcement:999901"];
  reminder.matchTaskId = "course:94257:assignment:262075";
  const plan = course("GEA1000", existing(), { candidates: changed });
  expect(plan.projections.filter((task) => /^quiz 3/i.test(task.title))).toHaveLength(1);
  expect(
    plan.projections.find((task) => task.id === "course:94257:assignment:262075"),
  ).toBeDefined();

  const sharedSource = "course:97325:announcement:493987";
  const proposal: CourseCandidate = {
    courseCode: "IS1128",
    sourceIds: [sharedSource],
    evidence: "proposal",
    kind: "assessment",
    title: "Submit proposal",
    requiredAction: "Submit",
    availableFrom: null,
    dueAt: "2026-09-20T15:59:59Z",
    eventEndsAt: null,
    confidence: 0.95,
    ambiguity: null,
    matchTaskId: null,
    logicalKey: `source:${sharedSource}#proposal`,
  };
  const report: CourseCandidate = {
    ...proposal,
    title: "Submit final report",
    logicalKey: `source:${sharedSource}#report`,
  };
  const distinct = course("IS1128", [], { candidates: [proposal, report] });
  expect(distinct.projections.map((task) => task.id)).toHaveLength(2);
  expect(new Set(distinct.projections.map((task) => task.id)).size).toBe(2);
});

test("a dropped derived task remains dropped after the candidate wording changes", () => {
  const candidate: CourseCandidate = {
    courseCode: "IS1128",
    sourceIds: ["course:97325:announcement:493987"],
    evidence: "response",
    kind: "assessment",
    title: "Respond to proposal reminder",
    requiredAction: "Respond",
    availableFrom: null,
    dueAt: "2026-09-20T15:59:59Z",
    eventEndsAt: null,
    confidence: 0.95,
    ambiguity: null,
    matchTaskId: null,
    logicalKey: "source:course:97325:announcement:493987#response",
  };
  const fact = candidateToFact(candidate);
  const rows: Array<ExistingAction> = [
    {
      id: "dropped",
      automatedIdentity: fact.id,
      properties: {
        "Canvas Item ID": fact.id,
        "Canvas Item Type": "assessment",
        Course: "IS1128",
        Status: "Dropped",
        "Needs Review": false,
      },
    },
  ];
  const changed = { ...candidate, title: "Respond to the project proposal reminder" };
  const plan = planCourse({
    records: [],
    candidates: { candidates: [changed] },
    existing: rows,
    reconciliationState: emptyReconciliationState(),
    now,
    syncedAt: now.toISOString(),
  });
  expect(plan.projections[0]?.state).toBe("inactive");
  expect(plan.projections[0]?.reason).toBe("Preserved user choice");
});

test("planCourse applies terminal prerequisite choices before dependency projection", () => {
  for (const status of ["Done", "Dropped"] as const) {
    const candidates = [5, 6].map((number) => ({
      courseCode: "CS2030S" as const,
      sourceIds: [`course:97326:assignment:${number}`],
      evidence: "Complete diagnostic",
      kind: "assessment" as const,
      title: `Diagnostic 0${number}`,
      requiredAction: "Complete diagnostic",
      availableFrom: "2026-09-01T00:00:00Z",
      dueAt: null,
      eventEndsAt: null,
      confidence: 0.99,
      ambiguity: null,
      matchTaskId: null,
      logicalKey: `source:course:97326:assignment:${number}#diagnostic`,
    }));
    const first = candidateToFact(candidates[0]!);
    const rows: Array<ExistingAction> = [
      {
        id: "diagnostic-5",
        automatedIdentity: first.id,
        properties: { Status: status },
      },
      {
        id: "diagnostic-6",
        automatedIdentity: candidateToFact(candidates[1]!).id,
        properties: { Status: "Not started" },
      },
    ];
    const result = planCourse({
      records: [],
      candidates: { candidates },
      existing: rows,
      reconciliationState: emptyReconciliationState(),
      now,
      syncedAt: now.toISOString(),
    });
    const next = result.projections.find((projection) => projection.title === "Diagnostic 06");
    expect(next?.state).toBe("ready");
    expect(next?.blockedBy).toBe(null);
  }
});

test("an active lecture bundle expands in place across a persisted weekly sync", () => {
  const moduleRecord = (week: number) => ({
    id: `course:94257:module:${week}`,
    courseCode: "GEA1000" as const,
    kind: "module" as const,
    sourceUrl: null,
    contentHash: `module-${week}`,
    fields: {
      name: `Week ${week}`,
      state: "available",
      items: [
        {
          id: `${week}`,
          title: "Content videos",
          lockedForUser: false,
          htmlUrl: `https://canvas.example/week-${week}`,
        },
      ],
    },
  });
  const first = planCourse({
    records: [moduleRecord(5), moduleRecord(6)],
    candidates: { candidates: [] },
    existing: [],
    reconciliationState: emptyReconciliationState(),
    now,
    syncedAt: now.toISOString(),
  });
  expect(first.operations).toHaveLength(1);
  expect(first.operations[0]?.type).toBe("create");
  const create = first.operations[0]!;
  const rows: Array<ExistingAction> = [
    {
      id: "lecture-bundle-page",
      automatedIdentity: create.identity,
      properties: {
        ...create.properties,
        Action: "My lecture block",
        Notes: "keep this note",
        Status: "Not started",
      },
    },
  ];
  const state = stateAfterVerifiedWrites(
    emptyReconciliationState(),
    rows,
    first.projections,
    first.operations,
  );
  const second = planCourse({
    records: [moduleRecord(5), moduleRecord(6), moduleRecord(7)],
    candidates: { candidates: [] },
    existing: rows,
    reconciliationState: state,
    now,
    syncedAt: now.toISOString(),
  });
  expect(second.operations).toHaveLength(1);
  expect(second.operations[0]).toMatchObject({ type: "update", pageId: "lecture-bundle-page" });
  expect(
    second.operations[0]?.type === "update" ? second.operations[0].properties : {},
  ).toHaveProperty("Parent Canvas ID");
  expect(
    second.operations[0]?.type === "update" ? second.operations[0].properties : {},
  ).not.toHaveProperty("Action");
  const update = second.operations[0]!;
  if (update.type === "update") Object.assign(rows[0]!.properties, update.properties);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.properties.Action).toBe("My lecture block");
  expect(rows[0]?.properties.Notes).toBe("keep this note");
  expect(rows[0]?.properties.Status).toBe("Not started");
});

test("ambiguous lecture bundle overlap is reported as a plan conflict", () => {
  const moduleRecord = (week: number) => ({
    id: `course:94257:module:${week}`,
    courseCode: "GEA1000" as const,
    kind: "module" as const,
    sourceUrl: null,
    contentHash: `module-${week}`,
    fields: {
      name: `Week ${week}`,
      state: "available",
      items: [
        {
          id: `${week}`,
          title: "Content videos",
          lockedForUser: false,
          htmlUrl: `https://canvas.example/week-${week}`,
        },
      ],
    },
  });
  const result = planCourse({
    records: [moduleRecord(5), moduleRecord(6), moduleRecord(7), moduleRecord(8)],
    candidates: { candidates: [] },
    existing: [
      {
        id: "bundle-one",
        automatedIdentity: "bundle:GEA1000:one",
        properties: {
          "Canvas Item Type": "e-lecture",
          "Parent Canvas ID": "course:94257:module:5:item:5\ncourse:94257:module:6:item:6",
          Status: "Not started",
        },
      },
      {
        id: "bundle-two",
        automatedIdentity: "bundle:GEA1000:two",
        properties: {
          "Canvas Item Type": "e-lecture",
          "Parent Canvas ID": "course:94257:module:7:item:7",
          Status: "Not started",
        },
      },
    ],
    reconciliationState: emptyReconciliationState(),
    now,
    syncedAt: now.toISOString(),
  });
  expect(result.operations).toEqual([]);
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0]?.reason).toContain("Multiple or split active lecture bundles");
  expect(result.conflicts[0]?.sourceIds).toContain("course:94257:module:8:item:8");
});
