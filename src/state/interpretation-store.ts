import { Effect, FileSystem, Schema } from "effect";
import { migrateCandidateEnvelope } from "../ai/state";
import type { CandidateEnvelope } from "../ai/types";
import { CandidateEnvelopeSchema } from "../ai/validate";
import type { CourseCode } from "../config/courses";
import { writeJsonAtomic } from "./atomic";
import { interpretationPath } from "./paths";

export const readInterpretation = Effect.fn("readInterpretation")(function* (
  dataDir: string,
  courseCode: CourseCode,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = interpretationPath(dataDir, courseCode);
  if (!(yield* fs.exists(path))) return null;
  const raw = yield* fs.readFileString(path);
  const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CandidateEnvelopeSchema))(
    raw,
  );
  return migrateCandidateEnvelope(decoded);
});

export const writeInterpretation = Effect.fn("writeInterpretation")(function* (
  dataDir: string,
  courseCode: CourseCode,
  candidates: CandidateEnvelope,
) {
  yield* writeJsonAtomic(
    interpretationPath(dataDir, courseCode),
    migrateCandidateEnvelope(candidates),
  );
});
