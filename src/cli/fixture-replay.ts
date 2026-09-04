import { BunRuntime } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { replayFixtures } from "../collector/replay";

const program = Effect.gen(function* () {
  const dir = Bun.argv[2];
  if (!dir) return yield* Effect.fail(new Error("usage: bun run fixture:replay -- <fixture-dir>"));

  const results = yield* Effect.try(() => replayFixtures(dir));
  for (const [course, diff] of Object.entries(results)) {
    yield* Console.log(
      `${course}: +${diff.added.length} ~${diff.changed.length} -${diff.removed.length}`,
    );
  }
});

BunRuntime.runMain(program);
