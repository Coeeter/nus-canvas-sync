import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import type { CourseCode } from "../config/courses";
import type { NormalizedRecord } from "../normalize/types";
import { writeJsonAtomic } from "./atomic";
import { baselinePath } from "./paths";

/** DIF-001: the previous successful snapshot for one course, retained independently of the others. */
export const readBaseline = Effect.fn("readBaseline")(function* (
  dataDir: string,
  courseCode: CourseCode,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = baselinePath(dataDir, courseCode);
  const exists = yield* fs.exists(path);
  if (!exists) {
    const empty: Array<NormalizedRecord> = [];
    return empty;
  }
  const raw = yield* fs.readFileString(path);
  return yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Array(normalizedRecordSchema)),
  )(raw);
});

/** DIF-003, DIF-004: call only after a course's full pipeline succeeds, so a failed course keeps its old baseline. */
export const writeBaseline = Effect.fn("writeBaseline")(function* (
  dataDir: string,
  courseCode: CourseCode,
  records: ReadonlyArray<NormalizedRecord>,
) {
  yield* writeJsonAtomic(baselinePath(dataDir, courseCode), records);
});

const normalizedRecordSchema = Schema.Struct({
  id: Schema.String,
  courseCode: Schema.Literals(["CS2030S", "GEA1000", "GESS1001", "IS1128", "MA1301"]),
  kind: Schema.Literals([
    "assignment",
    "quiz",
    "announcement",
    "module",
    "page",
    "file",
    "document",
    "planner-item",
    "github-repo",
    "github-commit",
  ]),
  sourceUrl: Schema.NullOr(Schema.String),
  contentHash: Schema.String,
  fields: Schema.Record(Schema.String, Schema.Unknown),
});
