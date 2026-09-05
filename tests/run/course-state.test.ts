import { expect, test } from "bun:test";
import { restoreUserDecisions } from "../../src/run/course-state";
import type { CourseState } from "../../src/state/course-store";

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
