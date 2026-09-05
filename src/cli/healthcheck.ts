import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Config, Console, DateTime, Effect, FileSystem, Predicate, Schema } from "effect";
import { runProcess } from "../collector/process";
import { COURSES } from "../config/courses";
import { readCourseState } from "../state/course-store";

const expected = [
  ["canvas", ["--version"], "canvas-cli version 1.13.0"],
  ["codex", ["--version"], "codex-cli 0.150.1"],
  ["gh", ["--version"], "gh version 2.98.0"],
] as const;

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const env = Object.fromEntries(
    ["PATH", "HOME", "LANG", "LC_ALL", "SSL_CERT_FILE"].flatMap((key) => {
      const value = process.env[key];
      return Predicate.isString(value) ? [[key, value] as const] : [];
    }),
  );

  for (const [binary, args, version] of expected) {
    const result = yield* runProcess(binary, args, env);
    if (result.exitCode !== 0 || !result.stdout.trim().includes(version)) {
      return yield* Effect.fail(
        new Error(`${binary} is unavailable or not pinned to the expected version`),
      );
    }
  }

  for (const file of ["prompts/extract-course.md", "schemas/course-candidates.schema.json"]) {
    if (!(yield* fs.exists(file)))
      return yield* Effect.fail(new Error(`Missing runtime file: ${file}`));
  }

  const mode = yield* Config.string("HEALTHCHECK_MODE").pipe(Config.withDefault("sync"));
  if (mode !== "artifacts") {
    const dataDir = yield* Config.string("DATA_DIR").pipe(Config.withDefault("./data"));
    const maxAge = yield* Config.number("HEALTHCHECK_MAX_AGE_HOURS").pipe(Config.withDefault(12));
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const status = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Struct({ ok: Schema.Boolean, finishedAt: Schema.String })),
    )(yield* fs.readFileString(`${dataDir}/run-status.json`));
    if (!status.ok) return yield* Effect.fail(new Error("Last sync failed"));
    for (const course of COURSES) {
      const state = yield* readCourseState(dataDir, course.code);
      if (
        !state ||
        !Number.isFinite(Date.parse(state.syncedAt)) ||
        now - Date.parse(state.syncedAt) > maxAge * 3600_000
      )
        return yield* Effect.fail(new Error(`No fresh successful sync for ${course.code}`));
    }
  }
  yield* Console.log(JSON.stringify({ event: "healthcheck", ok: true, mode }));
}).pipe(Effect.provide(BunServices.layer));

BunRuntime.runMain(program);
