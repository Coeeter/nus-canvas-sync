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
          await Bun.file(join(dataDir, "courses", `${course.code}.json`)).exists(),
        ] as const,
    ),
  );
  expect(advanced.filter(([, exists]) => exists).map(([code]) => code)).toEqual(
    COURSES.map((course) => course.code).filter((code): code is CourseCode => code !== "IS1128"),
  );
});

test("pipeline failures retain their actionable migration detail", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "nus-sync-migration-detail-"));
  const snapshotDir = join(dataDir, "snapshots", "run");
  await mkdir(snapshotDir, { recursive: true });
  const course = COURSES[0]!;
  const collection = {
    runId: "run",
    snapshotDir,
    records: { [course.code]: [] },
    diffs: { [course.code]: { added: [], changed: [], removed: [] } },
    manifest: {
      runId: "run",
      startedAt: "2026-09-03T04:00:00Z",
      finishedAt: "2026-09-03T04:00:00Z",
      planner: { status: "ok" },
      github: {},
      courses: [
        {
          courseCode: course.code,
          endpoints: {},
          diff: { added: 0, changed: 0, removed: 0 },
          outcome: "success" as const,
        },
      ],
    },
  } as CollectionResult;
  const result = await Effect.runPromise(
    runSync({
      collect: Effect.succeed(collection),
      notion: {
        listExistingActions: () =>
          Effect.succeed([
            {
              id: "legacy-page",
              automatedIdentity: "legacy-action",
              properties: { Course: course.code, Status: "Not started" },
            },
          ]),
        applyAndVerify: () => Effect.fail(new Error("unexpected write")),
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

  expect(result.failures[0]?.detail).toContain(
    "Unmapped active history requires explicit migration before this course can sync: legacy-page",
  );
});

test("an explicitly retired legacy row is archived without blocking the course", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "nus-sync-retire-"));
  const snapshotDir = join(dataDir, "snapshots", "run");
  await mkdir(snapshotDir, { recursive: true });
  const course = COURSES[0]!;
  const collection = {
    runId: "run",
    snapshotDir,
    records: { [course.code]: [] },
    diffs: { [course.code]: { added: [], changed: [], removed: [] } },
    manifest: {
      runId: "run",
      startedAt: "2026-09-03T04:00:00Z",
      finishedAt: "2026-09-03T04:00:00Z",
      planner: { status: "ok" },
      github: {},
      courses: [
        {
          courseCode: course.code,
          endpoints: {},
          diff: { added: 0, changed: 0, removed: 0 },
          outcome: "success" as const,
        },
      ],
    },
  } as CollectionResult;
  const operations: Array<{ archived?: boolean }> = [];
  const result = await Effect.runPromise(
    runSync({
      collect: Effect.succeed(collection),
      notion: {
        listExistingActions: () =>
          Effect.succeed([
            {
              id: "obsolete-page",
              automatedIdentity: "old-attendance",
              migrationDisposition: "retire" as const,
              properties: {
                Course: course.code,
                Status: "Not started",
                "Canvas Item ID": "old-attendance",
              },
            },
          ]),
        applyAndVerify: (operation) => {
          operations.push(operation);
          return Effect.succeed({ id: "obsolete-page" });
        },
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

  expect(result.ok).toBe(true);
  expect(operations).toEqual([expect.objectContaining({ archived: true })]);
});
