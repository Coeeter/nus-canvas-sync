import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import type { ExistingAction } from "../../src/reconcile/plan";
import {
  applyUserState,
  reviewRevision,
  stateAfterVerifiedWrites,
} from "../../src/reconcile/state";
import { projectTask } from "../../src/rules/lifecycle";
import { readReconciliationState } from "../../src/state/reconcile-store";

test("missing reconciliation state bootstraps, but corrupt state fails safely", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "nus-reconcile-state-"));
  expect(
    await Effect.runPromise(
      readReconciliationState(dataDir, "GEA1000").pipe(Effect.provide(BunServices.layer)),
    ),
  ).toEqual({ version: 1, tasks: {} });
  const path = join(dataDir, "reconciliation", "GEA1000.json");
  await mkdir(join(dataDir, "reconciliation"), { recursive: true });
  await writeFile(path, JSON.stringify({ version: 99, tasks: {} }));
  const result = await Effect.runPromiseExit(
    readReconciliationState(dataDir, "GEA1000").pipe(Effect.provide(BunServices.layer)),
  );
  expect(result._tag).toBe("Failure");
});

test("review acceptance cannot move an actionable gate before authoritative release", () => {
  const fact = {
    id: "course:97325:assignment:123",
    courseCode: "IS1128" as const,
    kind: "assessment" as const,
    title: "Project",
    sourceIds: ["course:97325:assignment:123"],
    observed: true,
    authoritativeAction: true,
    availableFrom: "2026-10-10T02:00:00Z",
    dueAt: "2026-10-20T02:00:00Z",
    conflict: { reason: "Confirm due date", sources: ["course:97325:assignment:123"] },
  };
  const resolved = applyUserState(
    fact,
    {
      id: "page",
      automatedIdentity: fact.id,
      properties: {
        "Needs Review": false,
        Readiness: "Review",
        "Available From": "2026-09-01T02:00:00Z",
      },
    },
    undefined,
  );
  expect(resolved.conflict).toBeDefined();
  expect(projectTask(resolved, new Date("2026-09-19T09:00:00Z")).state).toBe("review");
});

test("accepted review survives added evidence and equivalent date spelling", () => {
  const original = {
    id: "course:97325:assignment:123",
    courseCode: "IS1128" as const,
    kind: "assessment" as const,
    title: "Project",
    sourceIds: ["course:97325:assignment:123"],
    observed: true,
    authoritativeAction: true,
    availableFrom: "2026-09-19T02:00:00Z",
    dueAt: "2026-09-30T02:00:00Z",
    conflict: {
      reason: "Class time is not in supplied evidence",
      sources: ["course:97325:assignment:123"],
    },
  };
  const changedEvidence = {
    ...original,
    title: "Project submission",
    sourceIds: [...original.sourceIds, "course:97325:announcement:999999"],
    availableFrom: "2026-09-19T02:00:00.000+00:00",
    dueAt: "2026-09-30T02:00:00.000+00:00",
    conflict: {
      reason: "Supplied evidence does not specify the class time",
      sources: [...original.sourceIds, "course:97325:announcement:999999"],
    },
  };
  const stored = {
    logicalId: original.id,
    aliases: [],
    sourceIds: [...original.sourceIds],
    sourceProposal: {},
    lastWritten: {},
    review: {
      revision: reviewRevision(original)!,
      accepted: true,
      overrides: { dueAt: "2026-09-30T02:00:00Z" },
    },
  };
  const resolved = applyUserState(
    changedEvidence,
    {
      id: "page",
      automatedIdentity: original.id,
      properties: {
        "Needs Review": false,
        Readiness: "Review",
        "Official Due": "2026-09-30T02:00:00.000+00:00",
      },
    },
    stored,
  );
  expect(reviewRevision(changedEvidence)).toBe(stored.review.revision);
  expect(resolved.conflict).toBeUndefined();
  expect(resolved.reviewResolution?.overrides.dueAt).toBe("2026-09-30T02:00:00.000Z");
});

test("a changed disputed fact reopens an accepted review", () => {
  const original = {
    id: "course:97325:assignment:123",
    courseCode: "IS1128" as const,
    kind: "assessment" as const,
    title: "Project",
    sourceIds: ["course:97325:assignment:123"],
    observed: true,
    authoritativeAction: true,
    dueAt: "2026-09-30T02:00:00Z",
    conflict: { reason: "Confirm due date", sources: ["course:97325:assignment:123"] },
  };
  const stored = {
    logicalId: original.id,
    aliases: [],
    sourceIds: [...original.sourceIds],
    sourceProposal: {},
    lastWritten: {},
    review: {
      revision: reviewRevision(original)!,
      accepted: true,
      overrides: {},
    },
  };
  const changed = { ...original, dueAt: "2026-10-01T02:00:00Z" };
  const reopened = applyUserState(
    changed,
    {
      id: "page",
      automatedIdentity: original.id,
      properties: { "Needs Review": false, Readiness: "Review" },
    },
    stored,
  );
  expect(reviewRevision(changed)).not.toBe(stored.review.revision);
  expect(reopened.conflict).toBeDefined();
});

test("review revision ignores corroborating source order and duplicate issue facts", () => {
  const fact = {
    id: "task:IS1128:proposal",
    courseCode: "IS1128" as const,
    kind: "preparation" as const,
    title: "Prepare project proposal",
    sourceIds: ["source-a", "source-b"],
    observed: true,
    conflict: {
      reason: "Sources disagree on the deadline",
      sources: ["source-a", "source-b"],
      issue: {
        kind: "conflicting-deadline",
        fields: ["dueAt", "evidence"],
        values: [
          { field: "dueAt", sourceId: "source-a", state: "value", value: "2026-09-30" },
          { field: "dueAt", sourceId: "source-b", state: "value", value: "2026-10-01" },
        ],
      },
    },
  };
  const corroborated = {
    ...fact,
    sourceIds: ["source-b", "source-a", "source-c"],
    conflict: {
      ...fact.conflict,
      sources: ["source-c", "source-b", "source-a"],
      issue: {
        ...fact.conflict.issue,
        fields: ["evidence", "dueAt", "dueAt"],
        values: [
          ...fact.conflict.issue.values,
          { field: "dueAt", sourceId: "source-c", state: "value", value: "2026-09-30" },
        ],
      },
    },
  };
  expect(reviewRevision(corroborated)).toBe(reviewRevision(fact));
});

test("review revision changes for a different disputed value or affected field", () => {
  const fact = {
    id: "task:IS1128:proposal",
    courseCode: "IS1128" as const,
    kind: "preparation" as const,
    title: "Prepare project proposal",
    sourceIds: ["source-a", "source-b"],
    observed: true,
    conflict: {
      reason: "Sources disagree on the deadline",
      sources: ["source-a", "source-b"],
      issue: {
        kind: "conflicting-deadline",
        fields: ["dueAt"],
        values: [
          { field: "dueAt", sourceId: "source-a", state: "value", value: "2026-09-30" },
          { field: "dueAt", sourceId: "source-b", state: "value", value: "2026-10-01" },
        ],
      },
    },
  };
  const differentValue = {
    ...fact,
    conflict: {
      ...fact.conflict,
      issue: {
        ...fact.conflict.issue,
        values: [
          ...fact.conflict.issue.values.slice(0, 1),
          { field: "dueAt", sourceId: "source-b", state: "value", value: "2026-10-02" },
        ],
      },
    },
  };
  const differentField = {
    ...fact,
    conflict: {
      ...fact.conflict,
      issue: { ...fact.conflict.issue, fields: ["dueAt", "eventEndsAt"] },
    },
  };
  expect(reviewRevision(differentValue)).not.toBe(reviewRevision(fact));
  expect(reviewRevision(differentField)).not.toBe(reviewRevision(fact));
});

test("date-only release corrections use Singapore calendar semantics", () => {
  const fact = {
    id: "course:97325:assignment:123",
    courseCode: "IS1128" as const,
    kind: "assessment" as const,
    title: "Project",
    sourceIds: ["course:97325:assignment:123"],
    observed: true,
    authoritativeAction: true,
    availableFrom: "2026-09-19T20:00:00Z",
    dueAt: "2026-09-30T02:00:00Z",
    conflict: { reason: "Confirm due date", sources: ["course:97325:assignment:123"] },
  };
  const resolved = applyUserState(
    fact,
    {
      id: "page",
      automatedIdentity: fact.id,
      properties: {
        "Needs Review": false,
        Readiness: "Review",
        "Available From": "2026-09-20",
      },
    },
    undefined,
  );
  expect(resolved.conflict).toBeDefined();
  expect(projectTask(resolved, new Date("2026-09-19T19:59:59Z")).state).toBe("review");
});

test("verified state keeps prior ownership when a rebased field was skipped", () => {
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
  const previous = {
    version: 1 as const,
    tasks: {
      [projection.id]: {
        logicalId: projection.id,
        kind: projection.kind,
        title: projection.title,
        aliases: [],
        sourceIds: [...projection.sourceIds],
        sourceProposal: { "Official Due": "2026-09-25T02:00:00Z" },
        lastWritten: { "Official Due": "2026-09-25T02:00:00Z" },
      },
    },
  };
  const verified: ExistingAction = {
    id: "page",
    automatedIdentity: projection.id,
    properties: {
      "Canvas Item ID": projection.id,
      "Official Due": "2026-10-01T02:00:00Z",
    },
  };
  const saved = stateAfterVerifiedWrites(
    previous,
    [verified],
    [projection],
    [
      {
        type: "update",
        pageId: "page",
        identity: projection.id,
        properties: {
          "Official Due": "2026-09-30T02:00:00Z",
          "Last Synced": "2026-09-19T09:00:00.000Z",
        },
        expectedProperties: {
          "Canvas Item ID": projection.id,
          "Official Due": "2026-09-25T02:00:00Z",
        },
      },
    ],
  );
  expect(saved.tasks[projection.id]?.lastWritten["Official Due"]).toBe("2026-09-25T02:00:00Z");
});
