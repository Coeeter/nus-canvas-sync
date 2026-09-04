import { Schema } from "effect";
import { TaskAffectingFailureError } from "../errors";
import type { CandidateEnvelope } from "./types";

const CandidateEnvelopeSchema = Schema.Struct({
  candidates: Schema.Array(
    Schema.Struct({
      courseCode: Schema.Literals(["CS2030S", "GEA1000", "GESS1001", "IS1128", "MA1301"]),
      sourceIds: Schema.NonEmptyArray(Schema.String),
      evidence: Schema.NonEmptyString,
      kind: Schema.Literals([
        "assessment",
        "preparation",
        "e-lecture",
        "physical-event",
        "optional",
      ]),
      title: Schema.NonEmptyString,
      requiredAction: Schema.String,
      availableFrom: Schema.NullOr(Schema.String),
      dueAt: Schema.NullOr(Schema.String),
      eventEndsAt: Schema.NullOr(Schema.String),
      confidence: Schema.Number,
      ambiguity: Schema.NullOr(Schema.String),
    }),
  ),
});
const decodeCandidateEnvelope = Schema.decodeUnknownSync(CandidateEnvelopeSchema);

export function validateCandidates(
  raw: unknown,
  courseCode: string,
  allowedSourceIds: ReadonlySet<string>,
) {
  const envelope: CandidateEnvelope = decodeCandidateEnvelope(raw);
  for (const candidate of envelope.candidates) {
    if (candidate.courseCode !== courseCode) {
      throw invalid("candidate crossed the one-course boundary");
    }
    if (candidate.sourceIds.some((id) => !allowedSourceIds.has(id))) {
      throw invalid("candidate cites an unavailable source identity");
    }
    if (
      typeof candidate.confidence !== "number" ||
      candidate.confidence < 0 ||
      candidate.confidence > 1
    ) {
      throw invalid("candidate confidence is outside 0..1");
    }
  }
  return envelope;
}

function invalid(message: string) {
  return new TaskAffectingFailureError({ command: "validate Codex output", message });
}
