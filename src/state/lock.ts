import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";
import { RunLockedError } from "../errors";
import { runLockPath } from "./paths";

/**
 * DIF-005: exclusive creation (`wx`) fails if the lock file already exists,
 * so overlapping runs cannot proceed. Scoped so the lock is always released,
 * including on interruption or failure of the wrapped run.
 */
export function withRunLock<A, E, R>(dataDir: string, use: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const path = runLockPath(dataDir);

    yield* fs.makeDirectory(pathService.dirname(path), { recursive: true });

    yield* Effect.acquireRelease(
      fs
        .writeFileString(path, String(process.pid), { flag: "wx" })
        .pipe(
          Effect.catchTag("SystemError", (error) =>
            error.reason === "AlreadyExists"
              ? Effect.fail(new RunLockedError({ path }))
              : Effect.die(error),
          ),
        ),
      () => fs.remove(path, { force: true }).pipe(Effect.orDie),
    );

    return yield* use;
  }).pipe(Effect.scoped);
}
