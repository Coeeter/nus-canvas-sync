import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { BunContext } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { CodexCliExecutor, interpretCourse } from "../ai/interpret";
import { ResendAlertClient } from "../alerts/resend";
import { CanvasClient } from "../collector/canvas";
import { GithubClient } from "../collector/github";
import { collectUnlocked } from "../collector/run";
import { AppConfig } from "../config/env";
import { NotionClient } from "../notion/client";
import { runSync } from "../run/orchestrate";

const DATA_SOURCE_ID = "e04655de-e228-44cb-9042-597968f7057a";
const DASHBOARD_URL = "https://app.notion.com/p/3bd703fb987d81f4a438c7d430b7c38f";
const DASHBOARD_PAGE_ID = "3bd703fb987d81f4a438c7d430b7c38f";

const MainLive = Layer.mergeAll(
  CanvasClient.Default,
  GithubClient.Default,
  AppConfig.Default,
  BunContext.layer,
);

async function main() {
  const dataDir = process.env.DATA_DIR ?? "/data";
  await mkdir(dataDir, { recursive: true });
  const lockPath = join(dataDir, "run.lock");
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      console.log(JSON.stringify({ event: "sync_skipped", reason: "run_already_active" }));
      return;
    }
    throw error;
  }

  try {
    const notion = new NotionClient(
      required("NOTION_TOKEN"),
      (process.env.NOTION_DATA_SOURCE_ID ?? DATA_SOURCE_ID).replace("collection://", ""),
    );
    const alert = new ResendAlertClient(
      required("RESEND_API_KEY"),
      required("ALERT_EMAIL_FROM"),
      process.env.ALERT_EMAIL_TO ?? "nasrullah01n@gmail.com",
    );
    const executor = new CodexCliExecutor();
    const instructions = await Bun.file("prompts/extract-course.md").text();
    const schema = await Bun.file("schemas/course-candidates.schema.json").text();
    const healthBlockId =
      process.env.NOTION_HEALTH_BLOCK_ID ?? (await notion.findHealthBlock(DASHBOARD_PAGE_ID));
    const result = await runSync({
      collect: () => collectWithTransientRetry(dataDir),
      notion,
      interpret: (input) => interpretCourse(input, instructions, schema, executor),
      alert,
      healthBlockId,
      dashboardUrl: process.env.NOTION_DASHBOARD_URL ?? DASHBOARD_URL,
      dataDir,
    });
    console.log(
      JSON.stringify({
        event: "sync_finished",
        runId: result.collection.runId,
        ok: result.ok,
        courses: result.collection.manifest.courses.map((course) => ({
          course: course.courseCode,
          outcome: course.outcome,
        })),
      }),
    );
    if (!result.ok) process.exitCode = 1;
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

async function collectWithTransientRetry(dataDir: string) {
  const run = () => Effect.runPromise(collectUnlocked(dataDir).pipe(Effect.provide(MainLive)));
  const first = await run();
  const transient = first.manifest.courses.some((course) =>
    Object.values(course.endpoints).some((endpoint) => endpoint.status === "TransientFailureError"),
  );
  return transient ? run() : first;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

await main();
