import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { DateTime, Effect, type Layer } from "effect";
import { interpretCourse } from "../../src/ai/interpret";
import type { CourseCandidate } from "../../src/ai/types";
import type { CollectionResult } from "../../src/collector/run";
import { computeDiff } from "../../src/diff/compute";
import { contentHash } from "../../src/normalize/hash";
import type { NormalizedRecord } from "../../src/normalize/types";
import { NotionClient } from "../../src/notion/client";
import { runSync } from "../../src/run/orchestrate";
import { readBaseline } from "../../src/state/baseline-store";
import { readCourseState } from "../../src/state/course-store";
import { notionServer } from "../support/notion-server";

const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof BunServices.layer>>) =>
  Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));
const record = (
  id: string,
  kind: NormalizedRecord["kind"],
  fields: Record<string, unknown>,
  courseCode: NormalizedRecord["courseCode"] = "IS1128",
): NormalizedRecord => ({
  id,
  kind,
  courseCode,
  sourceUrl: null,
  contentHash: contentHash(fields),
  fields,
});
const assignment = (name = "Quiz 1") =>
  record("course:97325:assignment:1", "assignment", {
    name,
    description: "Attempt the quiz",
    published: true,
    lockedForUser: false,
    unlockAt: null,
    dueAt: "2026-09-09T15:59:59Z",
    lockAt: null,
  });

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "nus-transitions-"));
  const server = notionServer();
  const client = new NotionClient("fixture", "fixture", server.http, dir);
  let serial = 0;
  let alerts = 0;
  const step = async (
    records: Array<NormalizedRecord>,
    candidates: Array<CourseCandidate> = [],
    options: { failed?: boolean; runId?: string; course?: NormalizedRecord["courseCode"] } = {},
  ) => {
    const course = options.course ?? records[0]?.courseCode ?? "IS1128";
    const runId = options.runId ?? `run-${++serial}`;
    const snapshotDir = join(dir, "snapshots", runId);
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(join(snapshotDir, `${course}.json`), JSON.stringify(records));
    const baseline = await run(readBaseline(dir, course));
    const diff = computeDiff(baseline, records);
    const now = "2026-09-05T04:00:00Z";
    const collection: CollectionResult = {
      runId,
      snapshotDir,
      records: { [course]: records },
      diffs: { [course]: diff },
      manifest: {
        runId,
        startedAt: now,
        finishedAt: now,
        planner: { status: "ok" },
        github: {},
        courses: [
          {
            courseCode: course,
            outcome: options.failed ? "failed" : "success",
            endpoints: {},
            diff: {
              added: diff.added.length,
              changed: diff.changed.length,
              removed: diff.removed.length,
            },
          },
        ],
      },
    };
    return run(
      runSync({
        collect: Effect.succeed(collection),
        dataDir: dir,
        notion: client,
        now: DateTime.makeUnsafe(now),
        healthBlockId: "health",
        dashboardUrl: "https://fixture.invalid",
        alert: {
          send: () =>
            Effect.sync(() => {
              alerts++;
            }),
        },
        interpret: (input) =>
          interpretCourse(input, "Fixture extraction", "{}", {
            execute: (_prompt, _schema, output) =>
              Effect.promise(() =>
                writeFile(
                  output,
                  JSON.stringify({
                    candidates: candidates.map((candidate) => ({
                      availableFrom: null,
                      dueAt: null,
                      eventEndsAt: null,
                      ...candidate,
                    })),
                  }),
                ),
              ),
          }),
      }),
    );
  };
  return {
    dir,
    server,
    step,
    get alerts() {
      return alerts;
    },
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

test("A -> partial B -> C -> two absences -> restoration preserves one page and terminal choice", async () => {
  const h = await harness();
  try {
    expect((await h.step([assignment()])).ok).toBe(true);
    const page = h.server.values()[0]!;
    h.server.put(page.id, { ...page.properties, Status: "Done", Notes: "Keep my work" });
    expect((await h.step([], [], { failed: true })).ok).toBe(false);
    expect(await run(readBaseline(h.dir, "IS1128"))).toHaveLength(1);
    expect(h.server.values()[0]?.archived).toBe(false);
    expect((await h.step([assignment("Quiz 1 revised")])).ok).toBe(true);
    expect(h.server.values()[0]?.properties.Status).toBe("Done");
    expect((await h.step([], [], { runId: "absence-1" })).ok).toBe(true);
    expect(h.server.values()[0]?.properties["Missing Syncs"]).toBe(1);
    await h.step([], [], { runId: "absence-1" });
    expect(h.server.values()[0]?.properties["Missing Syncs"]).toBe(1);
    await h.step([], [], { runId: "absence-2" });
    expect(h.server.values()[0]?.archived).toBe(true);
    expect((await h.step([assignment()])).ok).toBe(true);
    expect(h.server.values()).toHaveLength(1);
    expect(h.server.values()[0]).toMatchObject({
      archived: false,
      properties: {
        Status: "Done",
        "Source State": "Active",
        "Missing Syncs": 0,
        Notes: expect.stringContaining("Keep my work"),
      },
    });
  } finally {
    await h.close();
  }
});

test("AI title paraphrase preserves Done; schema-valid lost work fails instead of deleting it", async () => {
  const h = await harness();
  try {
    const source = record("course:97325:announcement:8", "announcement", {
      message: "Install the required software. Changed detail A.",
    });
    const candidate: CourseCandidate = {
      courseCode: "IS1128",
      kind: "preparation",
      title: "Install software",
      requiredAction: "Install the required software",
      evidence: "Install the required software",
      sourceIds: [source.id],
      confidence: 0.95,
      ambiguity: null,
    };
    expect((await h.step([source], [candidate])).ok).toBe(true);
    const first = h.server.values()[0]!;
    h.server.put(first.id, { ...first.properties, Status: "Done" });
    const revised = record(source.id, "announcement", {
      message: "Install the required software. Changed detail B.",
    });
    expect((await h.step([revised], [{ ...candidate, title: "Set up software" }])).ok).toBe(true);
    expect(h.server.values()).toHaveLength(1);
    expect(h.server.values()[0]?.properties.Status).toBe("Done");
    // Test semantic loss on an unfinished row, not already completed history.
    h.server.put(first.id, { ...h.server.values()[0]!.properties, Status: "Not started" });
    const lost = record(source.id, "announcement", {
      message: "Install the required software. Changed detail C.",
    });
    expect((await h.step([lost], [])).ok).toBe(false);
    expect((await run(readBaseline(h.dir, "IS1128")))[0]?.contentHash).toBe(revised.contentHash);
  } finally {
    await h.close();
  }
});

test("shared brief retains three stages, Review correction survives until relevant evidence changes", async () => {
  const h = await harness();
  try {
    const brief = record("course:97325:document:9", "document", {
      text: "Submit proposal. Upload slides. Complete peer assessment.",
    });
    const stages = ["proposal", "slides", "peer assessment"].map(
      (stage): CourseCandidate => ({
        courseCode: "IS1128",
        kind: "assessment",
        actionKey: stage,
        title: stage,
        requiredAction: stage,
        evidence: stage,
        sourceIds: [brief.id],
        dueAt: "2026-09-20T15:59:00Z",
        confidence: 0.95,
        ambiguity: null,
      }),
    );
    expect((await h.step([brief], stages)).ok).toBe(true);
    expect(h.server.values()).toHaveLength(3);
    const page = h.server.values()[0]!;
    h.server.put(page.id, {
      ...page.properties,
      "Needs Review": false,
      "Official Due": "2026-09-21T15:59:00Z",
      Notes: "Confirmed with tutor",
    });
    expect((await h.step([brief], stages)).ok).toBe(true);
    expect(h.server.values()[0]?.properties).toMatchObject({
      "Needs Review": false,
      "Official Due": "2026-09-21T15:59:00Z",
      Notes: expect.stringContaining("Confirmed with tutor"),
    });
    expect((await h.step([brief], stages)).ok).toBe(true);
    expect(h.server.values()[0]?.properties["Needs Review"]).toBe(false);
    const changed = record(brief.id, "document", {
      text: `${brief.fields.text} Deadline amended.`,
    });
    expect((await h.step([changed], stages)).ok).toBe(true);
    expect(h.server.values()[0]?.properties["Needs Review"]).toBe(true);
  } finally {
    await h.close();
  }
});

test("new in-class assessment is tracked; old split files cannot replace a committed generation", async () => {
  const h = await harness();
  try {
    const quiz = record(
      "course:97359:assignment:5",
      "assignment",
      {
        name: "Quiz 5",
        description: "Physical quiz followed by upload",
        dueAt: "2026-09-11T04:00:00Z",
        unlockAt: null,
      },
      "MA1301",
    );
    expect((await h.step([quiz])).ok).toBe(true);
    expect(h.server.values()[0]?.properties).toMatchObject({
      Readiness: "Scheduled",
      "Work Mode": "During class",
    });
    await mkdir(join(h.dir, "baselines"), { recursive: true });
    await writeFile(join(h.dir, "baselines/MA1301.json"), "[]");
    expect(await run(readBaseline(h.dir, "MA1301"))).toHaveLength(1);
    expect((await run(readCourseState(h.dir, "MA1301")))?.records).toHaveLength(1);
    expect((await h.step([quiz])).ok).toBe(true);
    expect(h.server.values()).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test("completing a lecture bundle never reintroduces its weeks when the next week opens", async () => {
  const h = await harness();
  const week = (n: number) =>
    record(
      `course:94257:module:${n}`,
      "module",
      {
        name: `Week ${n}`,
        state: "unlocked",
        items: [{ id: n, title: "Content Videos", lockedForUser: false }],
      },
      "GEA1000",
    );
  try {
    expect((await h.step([week(1), week(2)])).ok).toBe(true);
    const bundle = h.server.values()[0]!;
    h.server.put(bundle.id, { ...bundle.properties, Status: "Done" });
    expect((await h.step([week(1), week(2), week(3)])).ok).toBe(true);
    const active = h.server
      .values()
      .filter((page) => !page.archived && page.properties.Status !== "Done");
    expect(active).toHaveLength(1);
    expect(active[0]?.properties["Parent Canvas ID"]).toBe("course:94257:module:3:item:3");
    const savedBundle = h.server.values().find((page) => page.id === bundle.id)!;
    h.server.put(bundle.id, { ...savedBundle.properties, Status: "Not started" });
    expect((await h.step([week(1), week(2), week(3)])).ok).toBe(true);
    expect(h.server.values().find((page) => page.id === bundle.id)).toMatchObject({
      archived: false,
      properties: { Status: "Not started", Readiness: "Ready" },
    });
    expect((await h.step([week(1), week(2), week(3)])).ok).toBe(true);
    expect(h.server.values().find((page) => page.id === bundle.id)?.properties.Readiness).toBe(
      "Ready",
    );
  } finally {
    await h.close();
  }
});

test("colliding fresh or retained candidates fail before writes and preserve the last generation", async () => {
  const h = await harness();
  try {
    const sources = ["a", "b"].map((slug) =>
      record(`course:97325:page:${slug}`, "page", { body: `Read chapter ${slug}.` }),
    );
    const candidates = sources.map(
      (source): CourseCandidate => ({
        courseCode: "IS1128",
        kind: "preparation",
        actionKey: "read-chapter",
        title: String(source.fields.body),
        requiredAction: String(source.fields.body),
        evidence: String(source.fields.body),
        sourceIds: [source.id],
        confidence: 1,
        ambiguity: null,
      }),
    );
    const freshCollision = await h.step(sources, candidates);
    expect(freshCollision.ok).toBe(false);
    expect(freshCollision.failures[0]?.detail).toContain("duplicate candidate action identity");
    expect(h.server.values()).toHaveLength(0);
    expect(await run(readCourseState(h.dir, "IS1128"))).toBeNull();

    expect((await h.step([sources[0]!], [candidates[0]!])).ok).toBe(true);
    const previous = await run(readCourseState(h.dir, "IS1128"));
    const pages = h.server.values();
    const retainedCollision = await h.step(sources, [candidates[1]!]);
    expect(retainedCollision.ok).toBe(false);
    expect(retainedCollision.failures[0]?.detail).toContain("duplicate candidate action identity");
    expect(h.server.values()).toEqual(pages);
    expect(await run(readCourseState(h.dir, "IS1128"))).toEqual(previous);

    expect(
      (await h.step(sources, [{ ...candidates[1]!, actionKey: "chapter-b-reading" }])).ok,
    ).toBe(true);
    expect(h.server.values()).toHaveLength(2);
    expect(new Set(h.server.values().map((page) => page.properties["Canvas Item ID"])).size).toBe(
      2,
    );
  } finally {
    await h.close();
  }
});

test("inline assignment briefs persist runway while pinned planning remains user-owned", async () => {
  const h = await harness();
  try {
    const source = record(assignment().id, "assignment", {
      ...assignment().fields,
      name: "Group report",
      description: "<p>Write a group research report.</p>",
      dueAt: "2026-09-19T15:59:00Z",
    });
    expect((await h.step([source])).ok).toBe(true);
    const page = h.server.values()[0]!;
    expect(page.properties).toMatchObject({ "Start By": "2026-09-05", Planned: "2026-09-05" });
    h.server.put(page.id, { ...page.properties, Pinned: true, Planned: "2026-09-07" });
    const revised = record(source.id, "assignment", {
      ...source.fields,
      dueAt: "2026-09-18T15:59:00Z",
    });
    expect((await h.step([revised])).ok).toBe(true);
    expect(h.server.values()[0]?.properties).toMatchObject({
      "Start By": "2026-09-04",
      Planned: "2026-09-07",
      Pinned: true,
    });
  } finally {
    await h.close();
  }
});
