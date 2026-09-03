import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { CourseCode } from "../config/courses";
import type { NormalizedRecord } from "../normalize/types";
import { writeJsonAtomic } from "./atomic";
import { baselinePath } from "./paths";

/** DIF-001: the previous successful snapshot for one course, retained independently of the others. */
export function readBaseline(dataDir: string, courseCode: CourseCode) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = baselinePath(dataDir, courseCode);
    const exists = yield* fs.exists(path);
    if (!exists) return [] as Array<NormalizedRecord>;
    const raw = yield* fs.readFileString(path);
    return JSON.parse(raw) as Array<NormalizedRecord>;
  });
}

/** DIF-003, DIF-004: call only after a course's full pipeline succeeds, so a failed course keeps its old baseline. */
export function writeBaseline(
  dataDir: string,
  courseCode: CourseCode,
  records: ReadonlyArray<NormalizedRecord>,
) {
  return writeJsonAtomic(baselinePath(dataDir, courseCode), records);
}
