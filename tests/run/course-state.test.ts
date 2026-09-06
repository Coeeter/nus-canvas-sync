import { expect, test } from "bun:test";
import type { TaskProjection } from "../../src/domain/task";
import type { NormalizedRecord } from "../../src/normalize/types";
import { planDates, restoreUserDecisions } from "../../src/run/course-state";
import type { CourseState } from "../../src/state/course-store";

test("runway reads cited inline briefs and linked documents, not unrelated bodies or metadata", () => {
  const task: TaskProjection = {
    id: "course:97325:assignment:1",
    sourceIds: ["course:97325:assignment:1"],
    memberSourceIds: ["course:97325:assignment:1"],
    courseCode: "IS1128",
    kind: "assessment",
    title: "Assignment",
    observed: true,
    state: "ready",
    actionable: true,
    needsReview: false,
    reason: null,
    dueAt: "2026-09-19",
  };
  const now = new Date("2026-09-05T04:00:00Z");
  for (const [kind, field] of [
    ["assignment", "description"],
    ["quiz", "description"],
    ["page", "body"],
    ["announcement", "message"],
    ["document", "text"],
  ] as const) {
    const source: NormalizedRecord = {
      id: `course:97325:${kind}:1`,
      courseCode: "IS1128",
      kind,
      sourceUrl: null,
      contentHash: "hash",
      fields: { [field]: "Write a group report." },
    };
    expect(planDates({ ...task, sourceIds: [source.id] }, now, [source])).toMatchObject({
      startBy: "2026-09-05",
      planned: "2026-09-05",
    });
  }
  const document: NormalizedRecord = {
    id: "course:97325:document:2",
    courseCode: "IS1128",
    kind: "document",
    sourceUrl: null,
    contentHash: "hash",
    fields: { text: "Write a group report.", referencedBy: task.sourceIds },
  };
  expect(planDates(task, now, [document]).startBy).toBe("2026-09-05");
  expect(
    planDates(task, now, [{ ...document, fields: { text: "Write a group report." } }]).startBy,
  ).toBeUndefined();
  const assignment: NormalizedRecord = {
    ...document,
    id: task.id,
    kind: "assignment",
    fields: {
      description: '<a href="https://example.org/group-report">Complete the worksheet.</a>',
    },
  };
  expect(planDates(task, now, [assignment]).startBy).toBe("2026-09-16");
  expect(
    planDates(task, now, [{ ...assignment, fields: { name: "Group report", description: " " } }])
      .startBy,
  ).toBeUndefined();
});

test("a retired legacy bundle is not adopted into current managed state", () => {
  const state = {
    version: 1,
    runId: "run",
    syncedAt: "2026-09-05T00:00:00Z",
    policy: "policy",
    records: [],
    candidates: { candidates: [] },
    managed: {},
    resolutions: {},
    memberChoices: {},
    terminalMembers: {},
    reviewFingerprints: {},
  } satisfies CourseState;

  restoreUserDecisions(
    [],
    [
      {
        id: "old-bundle",
        automatedIdentity: "bundle:GEA1000:old",
        migrationDisposition: "retire",
        properties: {
          Course: "GEA1000",
          Status: "Not started",
          "Parent Canvas ID": "course:94257:module:1:item:1",
        },
      },
    ],
    [
      {
        id: "course:94257:module:1",
        courseCode: "GEA1000",
        kind: "module",
        sourceUrl: null,
        contentHash: "hash",
        fields: {},
      },
    ],
    state,
  );

  expect(state.managed).toEqual({});
  expect(state.memberChoices).toEqual({});
});
