import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";
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
export function writeSnapshot(dataDir: string, snapshot: Snapshot) {
  return Effect.gen(function* () {
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
}

function repointLatest(dataDir: string, targetDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const linkPath = latestSnapshotLink(dataDir);
    const tmpLinkPath = `${linkPath}.tmp-${process.pid}-${Date.now()}`;
    yield* fs.symlink(pathService.relative(dataDir, targetDir), tmpLinkPath);
    yield* fs.rename(tmpLinkPath, linkPath);
  });
}
