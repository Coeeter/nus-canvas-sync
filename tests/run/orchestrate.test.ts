import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { DateTime, Effect } from "effect";
import type { CollectionResult } from "../../src/collector/run";
import { COURSES, type CourseCode } from "../../src/config/courses";
import type { NormalizedRecord } from "../../src/normalize/types";
import { runSync } from "../../src/run/orchestrate";

test("one course failure retains only its baseline and sends one alert", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "nus-sync-run-"));
  const snapshotDir = join(dataDir, "snapshots", "run");
  await mkdir(snapshotDir, { recursive: true });
  const changed = {
    id: `course:${COURSES.find((course) => course.code === "IS1128")!.id}:announcement:1`,
    courseCode: "IS1128",
    kind: "announcement",
    sourceUrl: null,
    contentHash: "hash",
    fields: { message: "changed" },
  } satisfies NormalizedRecord;
  const records = Object.fromEntries(
    COURSES.map((course) => [course.code, course.code === "IS1128" ? [changed] : []]),
  );
  const diffs = Object.fromEntries(
    COURSES.map((course) => [
      course.code,
      { added: course.code === "IS1128" ? [changed] : [], changed: [], removed: [] },
    ]),
  );
  const collection = {
    runId: "run",
    snapshotDir,
    records,
    diffs,
    manifest: {
      runId: "run",
      startedAt: "2026-09-03T04:00:00Z",
      finishedAt: "2026-09-03T04:00:00Z",
      planner: { status: "ok" },
      github: {},
      courses: COURSES.map((course) => ({
        courseCode: course.code,
        endpoints: {},
        diff: { added: 0, changed: 0, removed: 0 },
        outcome: "success" as const,
      })),
    },
  } as CollectionResult;
  let alerts = 0;
  const result = await Effect.runPromise(
    runSync({
      collect: Effect.succeed(collection),
      notion: {
        listExistingActions: () => Effect.succeed([]),
        applyAndVerify: () => Effect.fail(new Error("unexpected write")),
        syncPlannerViews: () => Effect.void,
        updateHealthBlock: () => Effect.void,
      },
      interpret: (input) =>
        input.courseCode === "IS1128"
          ? Effect.fail(new Error("invalid twice"))
          : Effect.succeed({ candidates: [] }),
      alert: {
        send: () => {
          alerts += 1;
          return Effect.void;
        },
      },
      healthBlockId: "health",
      dashboardUrl: "https://notion.example",
      dataDir,
      now: DateTime.makeUnsafe("2026-09-03T04:00:00Z"),
    }).pipe(Effect.provide(BunServices.layer)),
  );
  expect(result.ok).toBe(false);
  expect(alerts).toBe(1);
  expect(result.health).toContain("IS1128 failed");
  const advanced = await Promise.all(
    COURSES.map(
      async (course) =>
        [
          course.code,
          await Bun.file(join(dataDir, "baselines", `${course.code}.json`)).exists(),
        ] as const,
    ),
  );
  expect(advanced.filter(([, exists]) => exists).map(([code]) => code)).toEqual(
    COURSES.map((course) => course.code).filter((code): code is CourseCode => code !== "IS1128"),
  );
});

test("a partial Notion write does not advance reconciliation state or baseline", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "nus-sync-partial-"));
  const snapshotDir = join(dataDir, "snapshots", "partial");
  await mkdir(snapshotDir, { recursive: true });
  const collection = {
    runId: "partial",
    snapshotDir,
    records: Object.fromEntries(COURSES.map((course) => [course.code, []])),
    diffs: Object.fromEntries(
      COURSES.map((course) => [course.code, { added: [], changed: [], removed: [] }]),
    ),
    manifest: {
      runId: "partial",
      startedAt: "2026-09-03T04:00:00Z",
      finishedAt: "2026-09-03T04:00:00Z",
      planner: { status: "ok" },
      github: {},
      courses: COURSES.map((course) => ({
        courseCode: course.code,
        endpoints: {},
        diff: { added: 0, changed: 0, removed: 0 },
        outcome: "success" as const,
      })),
    },
  } as CollectionResult;
  let writes = 0;
  const result = await Effect.runPromise(
    runSync({
      collect: Effect.succeed(collection),
      notion: {
        listExistingActions: () => Effect.succeed([]),
        applyAndVerify: (operation) => {
          writes += 1;
          if (writes === 2) return Effect.fail(new Error("second write failed"));
          return Effect.succeed({
            id: `page-${writes}`,
            automatedIdentity: operation.identity,
            properties: operation.type === "create" ? operation.properties : {},
          });
        },
        syncPlannerViews: () => Effect.void,
        updateHealthBlock: () => Effect.void,
      },
      interpret: (input) =>
        input.courseCode === "IS1128"
          ? Effect.succeed({
              candidates: [
                {
                  courseCode: "IS1128",
                  sourceIds: ["course:97325:announcement:partial-1"],
                  evidence: "first",
                  kind: "assessment",
                  title: "First partial task",
                  requiredAction: "Submit",
                  dueAt: "2026-09-10T15:59:00Z",
                  confidence: 0.99,
                  ambiguity: null,
                  matchTaskId: null,
                  logicalKey: "source:course:97325:announcement:partial-1#first",
                },
                {
                  courseCode: "IS1128",
                  sourceIds: ["course:97325:announcement:partial-2"],
                  evidence: "second",
                  kind: "assessment",
                  title: "Second partial task",
                  requiredAction: "Submit",
                  dueAt: "2026-09-11T15:59:00Z",
                  confidence: 0.99,
                  ambiguity: null,
                  matchTaskId: null,
                  logicalKey: "source:course:97325:announcement:partial-2#second",
                },
              ],
            })
          : Effect.succeed({ candidates: [] }),
      alert: { send: () => Effect.void },
      healthBlockId: "health",
      dashboardUrl: "https://notion.example",
      dataDir,
      now: DateTime.makeUnsafe("2026-09-03T04:00:00Z"),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  expect(result.ok).toBe(false);
  expect(writes).toBe(2);
  expect(await Bun.file(join(dataDir, "reconciliation", "IS1128.json")).exists()).toBe(false);
  expect(await Bun.file(join(dataDir, "baselines", "IS1128.json")).exists()).toBe(false);
});

test("an ambiguous bundle fails the course before writes or baseline advancement", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "nus-sync-bundle-conflict-"));
  const snapshotDir = join(dataDir, "snapshots", "bundle-conflict");
  await mkdir(snapshotDir, { recursive: true });
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
  const records = Object.fromEntries(
    COURSES.map((course) => [
      course.code,
      course.code === "GEA1000"
        ? [moduleRecord(5), moduleRecord(6), moduleRecord(7), moduleRecord(8)]
        : [],
    ]),
  );
  const diffs = Object.fromEntries(
    COURSES.map((course) => [
      course.code,
      { added: records[course.code] ?? [], changed: [], removed: [] },
    ]),
  );
  const collection = {
    runId: "bundle-conflict",
    snapshotDir,
    records,
    diffs,
    manifest: {
      runId: "bundle-conflict",
      startedAt: "2026-09-03T04:00:00Z",
      finishedAt: "2026-09-03T04:00:00Z",
      planner: { status: "ok" },
      github: {},
      courses: COURSES.map((course) => ({
        courseCode: course.code,
        endpoints: {},
        diff: { added: 0, changed: 0, removed: 0 },
        outcome: "success" as const,
      })),
    },
  } as CollectionResult;
  let writes = 0;
  const result = await Effect.runPromise(
    runSync({
      collect: Effect.succeed(collection),
      notion: {
        listExistingActions: () =>
          Effect.succeed([
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
          ]),
        applyAndVerify: () => {
          writes += 1;
          return Effect.fail(new Error("unexpected write"));
        },
        syncPlannerViews: () => Effect.void,
        updateHealthBlock: () => Effect.void,
      },
      interpret: () => Effect.succeed({ candidates: [] }),
      alert: { send: () => Effect.void },
      healthBlockId: "health",
      dashboardUrl: "https://notion.example",
      dataDir,
      now: DateTime.makeUnsafe("2026-09-03T04:00:00Z"),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  expect(result.ok).toBe(false);
  expect(result.health).toContain("GEA1000 failed");
  expect(
    result.failures.some((failure) =>
      failure.detail.includes("Multiple or split active lecture bundles"),
    ),
  ).toBe(true);
  expect(writes).toBe(0);
  expect(await Bun.file(join(dataDir, "baselines", "GEA1000.json")).exists()).toBe(false);
  expect(await Bun.file(join(dataDir, "reconciliation", "GEA1000.json")).exists()).toBe(false);
});
