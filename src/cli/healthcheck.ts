import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, FileSystem, Predicate } from "effect";
import { runProcess } from "../collector/process";

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

  yield* Console.log(JSON.stringify({ event: "healthcheck", ok: true }));
}).pipe(Effect.provide(BunServices.layer));

BunRuntime.runMain(program);
