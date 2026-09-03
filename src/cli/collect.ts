import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { CanvasClient } from "../collector/canvas";
import { GithubClient } from "../collector/github";
import { collect } from "../collector/run";
import { AppConfig } from "../config/env";

const MainLive = Layer.mergeAll(
  CanvasClient.Default,
  GithubClient.Default,
  AppConfig.Default,
  BunContext.layer,
);

const program = Effect.gen(function* () {
  const config = yield* AppConfig;
  const result = yield* collect(config.dataDir);

  console.log(`Snapshot written to ${result.snapshotDir}`);
  for (const course of result.manifest.courses) {
    const diff = course.diff;
    console.log(
      `${course.courseCode}: ${course.outcome} (added ${diff.added}, changed ${diff.changed}, removed ${diff.removed})`,
    );
  }
}).pipe(Effect.provide(MainLive));

BunRuntime.runMain(program);
