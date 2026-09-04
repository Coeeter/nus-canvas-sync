import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { RunLockedError } from "../errors";
import { runLockPath } from "./paths";

/**
 * DIF-005: exclusive creation (`wx`) fails if the lock file already exists,
 * so overlapping runs cannot proceed. Scoped so the lock is always released,
 * including on interruption or failure of the wrapped run.
 */
export const withRunLock = Effect.fn("withRunLock")(function* <A, E, R>(
  dataDir: string,
  use: Effect.Effect<A, E, R>,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const path = runLockPath(dataDir);

  yield* fs.makeDirectory(pathService.dirname(path), { recursive: true });

  yield* Effect.acquireRelease(
    Effect.catchTag(
      fs.writeFileString(path, String(process.pid), { flag: "wx" }),
      "PlatformError",
      (error) =>
        error.reason._tag === "AlreadyExists"
          ? Effect.fail(new RunLockedError({ path }))
          : Effect.die(error),
    ),
    () => Effect.orDie(fs.remove(path, { force: true })),
  );

  return yield* use;
}, Effect.scoped);
