import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { CourseCode } from "../config/courses";
import type { NormalizedRecord } from "../normalize/types";
import { writeJsonAtomic } from "./atomic";
import type { RunManifest } from "./manifest";
import { latestSnapshotLink, snapshotDir } from "./paths";

export interface Snapshot {
  timestamp: string;
  manifest: RunManifest;
  courses: Partial<Record<CourseCode, Array<NormalizedRecord>>>;
}

/** DIF-001, DIF-006: writes one timestamped, immutable snapshot and repoints `latest` to it. */
export const writeSnapshot = Effect.fn("writeSnapshot")(function* (
  dataDir: string,
  snapshot: Snapshot,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const dir = snapshotDir(dataDir, snapshot.timestamp);
  yield* fs.makeDirectory(dir, { recursive: true });

  yield* writeJsonAtomic(pathService.join(dir, "manifest.json"), snapshot.manifest);
  for (const [courseCode, records] of Object.entries(snapshot.courses)) {
    yield* writeJsonAtomic(pathService.join(dir, "courses", `${courseCode}.json`), records);
  }

  yield* repointLatest(dataDir, dir);
  return dir;
});

const repointLatest = Effect.fn("repointLatest")(function* (dataDir: string, targetDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const linkPath = latestSnapshotLink(dataDir);
  const timestamp = yield* Clock.currentTimeMillis;
  const tmpLinkPath = `${linkPath}.tmp-${process.pid}-${timestamp}`;
  yield* fs.symlink(pathService.relative(dataDir, targetDir), tmpLinkPath);
  yield* fs.rename(tmpLinkPath, linkPath);
});
