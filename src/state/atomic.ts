import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** Writes `data` so a crash or interruption never leaves a partially written file (DIF-005). */
export const writeJsonAtomic = Effect.fn("writeJsonAtomic")(function* (
  path: string,
  data: unknown,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  yield* fs.makeDirectory(pathService.dirname(path), { recursive: true });
  const timestamp = yield* Clock.currentTimeMillis;
  const tmpPath = `${path}.tmp-${process.pid}-${timestamp}`;
  yield* fs.writeFileString(tmpPath, JSON.stringify(data, null, 2));
  yield* fs.rename(tmpPath, path);
});
