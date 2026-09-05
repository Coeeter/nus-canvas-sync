import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { ConfigProvider, DateTime, Effect, Redacted } from "effect";
import { interpretCourse } from "../../src/ai/interpret";
import { CanvasClient } from "../../src/collector/canvas";
import { collectCourse } from "../../src/collector/run";
import { COURSES } from "../../src/config/courses";
import { AppConfig } from "../../src/config/env";
import { NotionClient } from "../../src/notion/client";
import { runSync } from "../../src/run/orchestrate";
import { writeSnapshot } from "../../src/state/snapshot-store";
import { notionServer } from "../support/notion-server";

// Runs the installed pinned CLI against only a loopback server, with a fixture
// token. No authenticated upstream requests or fixture-specific client mocks.
const realCliTest = Bun.which("canvas") ? test : test.skip;
realCliTest(
  "Canvas CLI pagination -> missing inline items -> readable page/file -> normalized document; child failure fails coverage",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "nus-canvas-local-"));
    const requests: Array<string> = [];
    let pageFailure = false;
    const course = COURSES.find((course) => course.code === "GEA1000")!;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url.pathname + url.search);
        const base = url.origin;
        const page = (slug: string) => ({
          page_id: 1,
          url: slug,
          title: "Assessment instructions",
          body: `<a href="${base}/courses/${course.id}/files/50">Read brief</a>`,
          published: true,
          updated_at: "2026-09-01T00:00:00Z",
        });
        if (url.pathname === `/api/v1/courses/${course.id}`)
          return Response.json({ id: course.id, name: course.code, workflow_state: "available" });
        if (url.pathname === "/api/v1/accounts") return Response.json([]);
        if (url.pathname === "/api/v1/announcements") {
          const second = url.searchParams.get("page") === "2";
          return Response.json(
            [
              {
                id: second ? 2 : 1,
                title: second ? "Welcome in August" : "New notice",
                message: "Read the course instructions",
                posted_at: second ? "2026-08-01T00:00:00Z" : "2026-09-05T00:00:00Z",
              },
            ],
            { headers: second ? {} : { Link: `<${base}${url.pathname}?page=2>; rel="next"` } },
          );
        }
        if (url.pathname.endsWith("/modules/10/items"))
          return Response.json([
            { id: 1, title: "Assessment instructions", type: "Page", page_url: "assessment" },
            { id: 2, title: "Project brief.txt", type: "File", content_id: 50 },
          ]);
        if (url.pathname.endsWith("/modules"))
          return Response.json([{ id: 10, name: "Assignments", items_count: 2, items: null }]);
        if (url.pathname.endsWith("/pages"))
          return Response.json({ errors: [{ message: "not found" }] }, { status: 404 });
        if (url.pathname.endsWith("/pages/assessment"))
          return pageFailure
            ? Response.json({ errors: [{ message: "server failure" }] }, { status: 500 })
            : Response.json(page("assessment"));
        if (url.pathname.endsWith("/front_page"))
          return Response.json({ ...page("front"), body: "Course homepage" });
        if (url.pathname === "/api/v1/files/50")
          return Response.json({
            id: 50,
            display_name: "Project brief.txt",
            url: `${base}/download/50`,
            updated_at: "2026-09-01T00:00:00Z",
          });
        if (url.pathname === "/download/50")
          return new Response("Submit proposal. Upload slides. Complete peer assessment.");
        if (/\/(assignments|quizzes|files)$/.test(url.pathname)) return Response.json([]);
        return Response.json({ errors: [{ message: "unknown fixture route" }] }, { status: 404 });
      },
    });
    try {
      const program = Effect.gen(function* () {
        const canvas = yield* CanvasClient.make;
        return yield* collectCourse(course, {
          canvas,
          dataDir: dir,
          plannerRecords: [],
          githubRepos: [],
          githubCommits: [],
          upstreamHealthy: true,
        });
      }).pipe(
        Effect.provideService(AppConfig, {
          canvasUrl: server.url.origin,
          canvasToken: Redacted.make("fixture-token"),
          githubToken: Redacted.make("fixture-token"),
          dataDir: dir,
        }),
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: dir, PATH: process.env.PATH })),
        ),
        Effect.provide(BunServices.layer),
      );
      const collected = await Effect.runPromise(program);
      expect(collected.entry.outcome).toBe("success");
      expect(collected.normalized.filter((record) => record.kind === "announcement")).toHaveLength(
        2,
      );
      expect(
        collected.normalized.find((record) => record.kind === "document")?.fields.text,
      ).toContain("Complete peer assessment");
      expect(
        requests.some(
          (url) => url.includes("start_date=2026-07-19") && url.includes("end_date=2027-01-10"),
        ),
      ).toBe(true);
      expect(requests.some((url) => url.includes("/modules/10/items"))).toBe(true);
      const notion = notionServer();
      const pipeline = await Effect.runPromise(
        Effect.gen(function* () {
          const runId = "loopback";
          const now = "2026-09-05T04:00:00Z";
          const manifest = {
            runId,
            startedAt: now,
            finishedAt: now,
            courses: [collected.entry],
            planner: { status: "ok" as const },
            github: {},
          };
          const records = { [course.code]: collected.normalized };
          const snapshotDir = yield* writeSnapshot(dir, {
            timestamp: runId,
            manifest,
            courses: records,
          });
          const document = collected.normalized.find((record) => record.kind === "document")!;
          return yield* runSync({
            dataDir: dir,
            collect: Effect.succeed({
              runId,
              snapshotDir,
              manifest,
              records,
              diffs: { [course.code]: collected.diff },
            }),
            notion: new NotionClient("fixture", "fixture", notion.http, dir),
            healthBlockId: "health",
            dashboardUrl: "https://fixture.invalid",
            now: DateTime.makeUnsafe(now),
            alert: { send: () => Effect.void },
            interpret: (input) =>
              interpretCourse(input, "Fixture", "{}", {
                execute: (_prompt, _schema, output) =>
                  Effect.promise(() =>
                    writeFile(
                      output,
                      JSON.stringify({
                        candidates: ["proposal", "slides", "peer assessment"].map((stage) => ({
                          courseCode: course.code,
                          sourceIds: [document.id],
                          title: stage,
                          actionKey: stage,
                          relationship: "action",
                          kind: "assessment",
                          requiredAction: stage,
                          evidence: stage,
                          confidence: 0.95,
                          ambiguity: null,
                          availableFrom: null,
                          dueAt: null,
                          eventEndsAt: null,
                        })),
                      }),
                    ),
                  ),
              }),
          });
        }).pipe(Effect.provide(BunServices.layer)),
      );
      expect(pipeline.ok).toBe(true);
      expect(notion.values()).toHaveLength(3);
      expect(notion.values().every((page) => page.properties.Readiness === "Review")).toBe(true);
      expect(await Bun.file(join(dir, "latest/manifest.json")).json()).toMatchObject({
        phase: "completed",
        ok: true,
      });
      pageFailure = true;
      const failed = await Effect.runPromise(program);
      expect(failed.entry.outcome).toBe("failed");
      expect(failed.diff).toEqual({ added: [], changed: [], removed: [] });
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  60000,
);
