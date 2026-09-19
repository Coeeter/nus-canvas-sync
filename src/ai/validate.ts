import { Schema } from "effect";
import { TaskAffectingFailureError } from "../errors";
import { isMachineDateValue } from "../reconcile/values";
import type { CandidateEnvelope } from "./types";

const DATE_FIELDS = ["availableFrom", "dueAt", "eventEndsAt"] as const;
const ISSUE_FIELDS = [...DATE_FIELDS, "evidence"] as const;
const ISSUE_KINDS = [
  "missing-class-time",
  "conflicting-class-time",
  "conflicting-deadline",
  "conflicting-release",
  "ambiguous-evidence",
  "other",
] as const;

const CandidateDateEvidenceSchema = Schema.Struct({
  state: Schema.Literals(["unknown", "value", "explicit-null"]),
  value: Schema.NullOr(Schema.String),
  sourceIds: Schema.NonEmptyArray(Schema.String),
});
const LegacyCandidateDateEvidenceSchema = Schema.Struct({
  state: Schema.Literals(["unknown", "value", "explicit-null"]),
  value: Schema.optional(Schema.NullOr(Schema.String)),
  sourceIds: Schema.NonEmptyArray(Schema.String),
});
const CandidateDateEvidenceEnvelopeSchema = Schema.Struct({
  availableFrom: CandidateDateEvidenceSchema,
  dueAt: CandidateDateEvidenceSchema,
  eventEndsAt: CandidateDateEvidenceSchema,
});
const LegacyCandidateDateEvidenceEnvelopeSchema = Schema.Struct({
  availableFrom: LegacyCandidateDateEvidenceSchema,
  dueAt: LegacyCandidateDateEvidenceSchema,
  eventEndsAt: LegacyCandidateDateEvidenceSchema,
});
const CandidateReviewValueSchema = Schema.Struct({
  field: Schema.Literals(ISSUE_FIELDS),
  sourceId: Schema.String,
  state: Schema.Literals(["unknown", "value", "explicit-null"]),
  value: Schema.NullOr(Schema.String),
});
const LegacyCandidateReviewValueSchema = Schema.Struct({
  field: Schema.Literals(ISSUE_FIELDS),
  sourceId: Schema.String,
  state: Schema.Literals(["unknown", "value", "explicit-null"]),
  value: Schema.optional(Schema.NullOr(Schema.String)),
});
const CandidateReviewIssueSchema = Schema.Struct({
  kind: Schema.Literals(ISSUE_KINDS),
  fields: Schema.NonEmptyArray(Schema.Literals(ISSUE_FIELDS)),
  values: Schema.NonEmptyArray(CandidateReviewValueSchema),
});
const LegacyCandidateReviewIssueSchema = Schema.Struct({
  kind: Schema.Literals(ISSUE_KINDS),
  fields: Schema.NonEmptyArray(Schema.Literals(ISSUE_FIELDS)),
  values: Schema.NonEmptyArray(LegacyCandidateReviewValueSchema),
});

export const CandidateEnvelopeSchema = Schema.Struct({
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
      dateEvidence: Schema.optional(LegacyCandidateDateEvidenceEnvelopeSchema),
      confidence: Schema.Number,
      ambiguity: Schema.NullOr(Schema.String),
      reviewIssue: Schema.optional(Schema.NullOr(LegacyCandidateReviewIssueSchema)),
      matchTaskId: Schema.optional(Schema.NullOr(Schema.String)),
      logicalKey: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});
const CandidateOutputEnvelopeSchema = Schema.Struct({
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
      dateEvidence: CandidateDateEvidenceEnvelopeSchema,
      confidence: Schema.Number,
      ambiguity: Schema.NullOr(Schema.String),
      reviewIssue: Schema.NullOr(CandidateReviewIssueSchema),
      matchTaskId: Schema.NullOr(Schema.String),
      logicalKey: Schema.NullOr(Schema.String),
    }),
  ),
});
const decodeCandidateEnvelope = Schema.decodeUnknownSync(CandidateOutputEnvelopeSchema);

export function validateCandidates(
  raw: unknown,
  courseCode: string,
  allowedSourceIds: ReadonlySet<string>,
  canonicalTaskIds: ReadonlySet<string> = new Set(),
) {
  const envelope = decodeCandidateEnvelope(raw) as CandidateEnvelope;
  for (const candidate of envelope.candidates) {
    if (candidate.courseCode !== courseCode) {
      throw invalid("candidate crossed the one-course boundary");
    }
    if (candidate.sourceIds.some((id) => !allowedSourceIds.has(id))) {
      throw invalid("candidate cites an unavailable source identity");
    }
    validateDateEvidence(candidate, allowedSourceIds);
    validateReviewIssue(candidate.reviewIssue, candidate.ambiguity, allowedSourceIds);
    if (
      candidate.matchTaskId !== undefined &&
      candidate.matchTaskId !== null &&
      !canonicalTaskIds.has(candidate.matchTaskId)
    ) {
      throw invalid("candidate match is not in the current canonical task inventory");
    }
    if (candidate.logicalKey !== undefined && candidate.logicalKey !== null) {
      if (candidate.logicalKey.length < 3 || /\s/.test(candidate.logicalKey)) {
        throw invalid("candidate logicalKey is not a compact stable key");
      }
      const anchor = candidate.logicalKey.match(/^source:(.+)#([^#]+)$/);
      if (!anchor || !allowedSourceIds.has(anchor[1]!)) {
        throw invalid("derived candidate logicalKey must anchor to one supplied source");
      }
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

function validateDateEvidence(
  candidate: CandidateEnvelope["candidates"][number],
  allowedSourceIds: ReadonlySet<string>,
) {
  if (!candidate.dateEvidence) return;
  for (const field of DATE_FIELDS) {
    const evidence = candidate.dateEvidence[field];
    if (evidence.sourceIds.some((id) => !allowedSourceIds.has(id))) {
      throw invalid(`${field} evidence cites an unavailable source identity`);
    }
    const value = candidate[field];
    if (evidence.state === "value") {
      if (
        !isMachineDateValue(value) ||
        !isMachineDateValue(evidence.value) ||
        value !== evidence.value
      ) {
        throw invalid(`${field} date evidence must match the candidate value`);
      }
    } else if (evidence.state === "explicit-null") {
      if (value !== null) throw invalid(`${field} explicit-null evidence must use a null value`);
      if (evidence.value !== null) throw invalid(`${field} explicit-null evidence has a value`);
    } else {
      if (value !== null) throw invalid(`${field} unknown evidence must use a null value`);
      if (evidence.value !== null) throw invalid(`${field} unknown evidence has a value`);
    }
  }
}

function validateReviewIssue(
  issue: CandidateEnvelope["candidates"][number]["reviewIssue"],
  ambiguity: string | null,
  allowedSourceIds: ReadonlySet<string>,
) {
  if (ambiguity !== null && !issue) {
    throw invalid("ambiguous candidate is missing its structured review issue");
  }
  if (!issue) return;
  const fields = new Set(issue.fields);
  for (const value of issue.values) {
    if (!allowedSourceIds.has(value.sourceId)) {
      throw invalid("review issue cites an unavailable source identity");
    }
    if (!fields.has(value.field))
      throw invalid("review issue value is outside its affected fields");
    if (value.state === "value" && typeof value.value !== "string") {
      throw invalid("review issue value state requires a value");
    }
    if (value.state !== "value" && value.value !== null) {
      throw invalid("review issue unknown or explicit-null value cannot carry a value");
    }
  }
}

function invalid(message: string) {
  return new TaskAffectingFailureError({ command: "validate Codex output", message });
}
