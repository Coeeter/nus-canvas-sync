import { Schema } from "effect";
import { TaskAffectingFailureError } from "../errors";
import { validSourceDate } from "../normalize/dates";
import type { NormalizedRecord } from "../normalize/types";
import type { CandidateEnvelope } from "./types";

export const CandidateEnvelopeSchema = Schema.Struct({
  candidates: Schema.Array(
    Schema.Struct({
      courseCode: Schema.Literals(["CS2030S", "GEA1000", "GESS1001", "IS1128", "MA1301"]),
      sourceIds: Schema.NonEmptyArray(Schema.String),
      evidence: Schema.NonEmptyString,
      actionKey: Schema.optional(Schema.NonEmptyString),
      identity: Schema.optional(Schema.String),
      relationship: Schema.optional(Schema.Literals(["action", "enrichment"])),
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
const normalizeEvidence = (value: string) =>
  value
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\\[nr]|\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim()
    .toLowerCase();

export function validateCandidates(
  raw: unknown,
  courseCode: string,
  allowedSourceIds: ReadonlySet<string>,
  records?: ReadonlyArray<NormalizedRecord>,
) {
  const envelope: CandidateEnvelope = decodeCandidateEnvelope(raw);
  const keys = new Set<string>();
  for (const candidate of envelope.candidates) {
    const key = JSON.stringify([
      candidate.kind,
      [...candidate.sourceIds].sort(),
      candidate.actionKey ?? candidate.title,
    ]);
    if (keys.has(key)) throw invalid("duplicate candidate action identity");
    keys.add(key);
    if (records && candidate.identity) throw invalid("model may not assign persisted identities");
    if (candidate.courseCode !== courseCode) {
      throw invalid("candidate crossed the one-course boundary");
    }
    if (candidate.sourceIds.some((id) => !allowedSourceIds.has(id))) {
      throw invalid("candidate cites an unavailable source identity");
    }
    if (
      [candidate.availableFrom, candidate.dueAt, candidate.eventEndsAt].some(
        (value) => value != null && !validSourceDate(value),
      )
    )
      throw invalid("candidate contains an invalid date");
    if (records) {
      const cited = candidate.sourceIds.flatMap((id) =>
        records.filter((record) => record.id === id),
      );
      const evidence = normalizeEvidence(candidate.evidence);
      const evidenced = cited.filter((record) =>
        normalizeEvidence(JSON.stringify(record.fields)).includes(evidence),
      );
      if (evidenced.length === 0)
        throw invalid("candidate evidence is not a verbatim excerpt of its cited sources");
      if (
        candidate.kind === "assessment" &&
        candidate.relationship === "action" &&
        evidenced.every((record) => record.kind === "assignment" || record.kind === "quiz")
      )
        throw invalid(
          "a candidate evidenced only by its dedicated assessment must use relationship=enrichment",
        );
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
