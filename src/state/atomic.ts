import { randomUUID } from "node:crypto";
import { Effect, FileSystem, Path } from "effect";

/** Commit a complete file on the same filesystem, flushing content before rename. */
export const writeJsonAtomic = Effect.fn("writeJsonAtomic")(function* (
  path: string,
  data: unknown,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const directory = pathService.dirname(path);
  yield* fs.makeDirectory(directory, { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  yield* Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(temporary, { flag: "wx", mode: 0o600 });
        yield* file.writeAll(new TextEncoder().encode(JSON.stringify(data, null, 2)));
        yield* file.sync;
      }),
    );
    yield* fs.rename(temporary, path);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const parent = yield* fs.open(directory, { flag: "r" });
        yield* parent.sync;
      }),
    );
  }).pipe(Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
});
