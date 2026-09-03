import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";

/** Writes `data` so a crash or interruption never leaves a partially written file (DIF-005). */
export function writeJsonAtomic(path: string, data: unknown) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    yield* fs.makeDirectory(pathService.dirname(path), { recursive: true });
    const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
    yield* fs.writeFileString(tmpPath, JSON.stringify(data, null, 2));
    yield* fs.rename(tmpPath, path);
  });
}
