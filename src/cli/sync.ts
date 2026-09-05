import { randomUUID } from "node:crypto";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Config, Console, DateTime, Effect, Layer, Option, Predicate, Result } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { CodexCliExecutor, interpretCourse } from "../ai/interpret";
import { ResendAlertClient } from "../alerts/resend";
import { CanvasClient } from "../collector/canvas";
import { GithubClient } from "../collector/github";
import { collectUnlocked } from "../collector/run";
import { NotionClient } from "../notion/client";
import { runSync } from "../run/orchestrate";
import { writeJsonAtomic } from "../state/atomic";
import { withRunLock } from "../state/lock";

const DATA_SOURCE_ID = "e04655de-e228-44cb-9042-597968f7057a";
const DASHBOARD_URL = "https://app.notion.com/p/3bd703fb987d81f4a438c7d430b7c38f";
const DASHBOARD_PAGE_ID = "3bd703fb987d81f4a438c7d430b7c38f";

const CollectorClientsLive = Layer.mergeAll(CanvasClient.layer, GithubClient.layer).pipe(
  Layer.provide(BunServices.layer),
);

const CollectorRuntimeLive = Layer.mergeAll(CollectorClientsLive, BunServices.layer);

const MainLive = Layer.mergeAll(BunServices.layer, FetchHttpClient.layer);

const collectWithTransientRetry = Effect.fn("collectWithTransientRetry")(function* (
  dataDir: string,
) {
  const first = yield* collectUnlocked(dataDir);
  const transient = first.manifest.courses.some((course) =>
    Object.values(course.endpoints).some((endpoint) => endpoint.status === "TransientFailureError"),
  );
  return transient ? yield* collectUnlocked(dataDir) : first;
});

const sync = Effect.fn("syncCli")(function* (dataDir: string) {
  const notionToken = yield* Config.redacted("NOTION_TOKEN");
  const notionDataSourceId = yield* Config.string("NOTION_DATA_SOURCE_ID").pipe(
    Config.withDefault(DATA_SOURCE_ID),
  );
  const resendApiKey = yield* Config.redacted("RESEND_API_KEY");
  const alertEmailFrom = yield* Config.string("ALERT_EMAIL_FROM");
  const alertEmailTo = yield* Config.string("ALERT_EMAIL_TO").pipe(
    Config.withDefault("nasrullah01n@gmail.com"),
  );
  const configuredHealthBlockId = yield* Config.option(Config.string("NOTION_HEALTH_BLOCK_ID"));
  const dashboardUrl = yield* Config.string("NOTION_DASHBOARD_URL").pipe(
    Config.withDefault(DASHBOARD_URL),
  );
  const fs = yield* FileSystem.FileSystem;
  const httpClient = yield* HttpClient.HttpClient;

  const notion = new NotionClient(
    notionToken,
    notionDataSourceId.replace("collection://", ""),
    httpClient,
    dataDir,
  );
  const alert = new ResendAlertClient(resendApiKey, alertEmailFrom, alertEmailTo, httpClient);
  const executor = new CodexCliExecutor();
  const instructions = yield* fs.readFileString("prompts/extract-course.md");
  const schema = yield* fs.readFileString("schemas/course-candidates.schema.json");
  yield* notion.validateSchema();
  const healthBlockId = Option.isSome(configuredHealthBlockId)
    ? configuredHealthBlockId.value
    : yield* notion.findHealthBlock(DASHBOARD_PAGE_ID);
  const result = yield* runSync({
    collect: collectWithTransientRetry(dataDir).pipe(Effect.provide(CollectorRuntimeLive)),
    notion,
    interpret: (input) => interpretCourse(input, instructions, schema, executor),
    alert,
    healthBlockId,
    dashboardUrl,
    dataDir,
    policyVersion: instructions + schema,
  });

  yield* writeJsonAtomic(`${dataDir}/run-status.json`, {
    ok: result.ok,
    finishedAt: DateTime.formatIso(yield* DateTime.now),
    runId: result.collection.runId,
  });
  yield* Console.log(
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
  if (!result.ok) {
    yield* Effect.sync(() => {
      process.exitCode = 1;
    });
  }
});

const program = Effect.gen(function* () {
  const dataDir = yield* Config.string("DATA_DIR").pipe(Config.withDefault("./data"));
  return yield* withRunLock(
    dataDir,
    sync(dataDir).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const time = DateTime.formatIso(yield* DateTime.now);
          yield* writeJsonAtomic(`${dataDir}/run-status.json`, {
            ok: false,
            finishedAt: time,
            stage: "fatal",
          }).pipe(Effect.ignore);
          const alert = yield* Effect.gen(function* () {
            const key = yield* Config.redacted("RESEND_API_KEY");
            const from = yield* Config.string("ALERT_EMAIL_FROM");
            const to = yield* Config.string("ALERT_EMAIL_TO").pipe(
              Config.withDefault("nasrullah01n@gmail.com"),
            );
            const http = yield* HttpClient.HttpClient;
            yield* new ResendAlertClient(key, from, to, http).send({
              runId: `fatal-${randomUUID()}`,
              runTime: time,
              summary: "LAST SYNC FAILED — system failure before completion",
              failures: [
                {
                  course: "SYSTEM",
                  stage: "fatal",
                  detail: "The sync could not complete; inspect local logs and configuration.",
                },
              ],
              dashboardUrl: DASHBOARD_URL,
            });
          }).pipe(Effect.result);
          if (Result.isFailure(alert))
            yield* Console.error(
              "Fatal sync alert could not be sent; inspect local configuration and logs.",
            );
          return yield* Effect.fail(error);
        }),
      ),
    ),
  );
}).pipe(
  Effect.catch((error) =>
    Predicate.isTagged("RunLockedError")(error)
      ? Console.log(JSON.stringify({ event: "sync_skipped", reason: "run_already_active" })).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              process.exitCode = 1;
            }),
          ),
        )
      : Effect.fail(error),
  ),
  Effect.provide(MainLive),
);

BunRuntime.runMain(program);
