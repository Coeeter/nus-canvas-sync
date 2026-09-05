import { dlopen } from "bun:ffi";
import { closeSync, openSync } from "node:fs";
import { Effect, FileSystem, Path } from "effect";
import { RunLockedError } from "../errors";
import { runLockPath } from "./paths";

// Kernel ownership survives neither process death nor reboot. Never unlink the
// file: two processes must always lock the same inode, including during cleanup.
const libc = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
  flock: { args: ["i32", "i32"], returns: "i32" },
});

export const withRunLock = Effect.fn("withRunLock")(function* <A, E, R>(
  dataDir: string,
  use: Effect.Effect<A, E, R>,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const path = runLockPath(dataDir);
  yield* fs.makeDirectory(pathService.dirname(path), { recursive: true });
  yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const fd = openSync(path, "a", 0o600);
        if (libc.symbols.flock(fd, 2 | 4) !== 0) {
          closeSync(fd);
          throw new RunLockedError({ path });
        }
        return fd;
      },
      catch: (error) => error,
    }),
    (fd) => Effect.sync(() => closeSync(fd)),
  );
  return yield* use;
}, Effect.scoped);
