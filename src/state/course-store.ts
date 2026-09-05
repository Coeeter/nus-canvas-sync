import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import type { CandidateEnvelope } from "../ai/types";
import { CandidateEnvelopeSchema } from "../ai/validate";
import type { CourseCode } from "../config/courses";
import { writeJsonAtomic } from "./atomic";
import { normalizedRecordSchema } from "./record-schema";

const ResolutionSchema = Schema.Struct({
  fingerprint: Schema.String,
  dueAt: Schema.NullOr(Schema.String),
  availableFrom: Schema.NullOr(Schema.String),
});
const ManagedSchema = Schema.Struct({
  pageId: Schema.String,
  sourceIds: Schema.Array(Schema.String),
  missing: Schema.Number,
  lastSeenRun: Schema.String,
});
const CourseStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  runId: Schema.String,
  syncedAt: Schema.String,
  policy: Schema.String,
  records: Schema.Array(normalizedRecordSchema),
  candidates: CandidateEnvelopeSchema,
  managed: Schema.Record(Schema.String, ManagedSchema),
  resolutions: Schema.Record(Schema.String, ResolutionSchema),
  memberChoices: Schema.Record(
    Schema.String,
    Schema.Struct({ status: Schema.String, members: Schema.Array(Schema.String) }),
  ),
  terminalMembers: Schema.Record(Schema.String, Schema.Literals(["Done", "Dropped"])),
  reviewFingerprints: Schema.Record(Schema.String, Schema.String),
});
type DecodedState = typeof CourseStateSchema.Type;
export type CourseState = Omit<
  DecodedState,
  | "candidates"
  | "managed"
  | "resolutions"
  | "terminalMembers"
  | "reviewFingerprints"
  | "memberChoices"
> & {
  candidates: CandidateEnvelope;
  managed: Record<string, typeof ManagedSchema.Type>;
  resolutions: Record<string, typeof ResolutionSchema.Type>;
  terminalMembers: Record<string, "Done" | "Dropped">;
  memberChoices: Record<string, { status: string; members: ReadonlyArray<string> }>;
  reviewFingerprints: Record<string, string>;
};
export const readCourseState = Effect.fn("readCourseState")(function* (
  dataDir: string,
  course: CourseCode,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = join(dataDir, "courses", `${course}.json`);
  if (!(yield* fs.exists(path))) return null;
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CourseStateSchema))(
    yield* fs.readFileString(path),
  );
});
export const writeCourseState = Effect.fn("writeCourseState")(function* (
  dataDir: string,
  course: CourseCode,
  state: CourseState,
) {
  yield* writeJsonAtomic(join(dataDir, "courses", `${course}.json`), state);
});
