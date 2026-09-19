import { isMachineDateValue } from "../reconcile/values";
import type {
  CandidateDateEvidence,
  CandidateDateField,
  CandidateEnvelope,
  CandidateReviewIssue,
  CandidateReviewValue,
} from "./types";

export function mergeCandidateEnvelopes(
  previous: CandidateEnvelope,
  fresh: CandidateEnvelope,
  affectedSourceIds: ReadonlySet<string>,
): CandidateEnvelope {
  return {
    candidates: [
      ...previous.candidates.filter((candidate) =>
        candidate.sourceIds.every((sourceId) => !affectedSourceIds.has(sourceId)),
      ),
      ...fresh.candidates,
    ],
  };
}

/**
 * Upgrade pre-structured caches without guessing explicit date removal or
 * inventing a conflict. Legacy nulls become `unknown`; only a legacy string
 * becomes a known value. Legacy ambiguity remains available as display prose
 * and is interpreted by the reducer's explicitly marked compatibility path.
 */
export function migrateCandidateEnvelope(envelope: CandidateEnvelope): CandidateEnvelope {
  return { candidates: envelope.candidates.map(migrateCandidate) };
}

const DATE_FIELDS: ReadonlyArray<CandidateDateField> = ["availableFrom", "dueAt", "eventEndsAt"];

function migrateCandidate(candidate: CandidateEnvelope["candidates"][number]) {
  const sourceIds = [...candidate.sourceIds];
  const malformed: Array<CandidateReviewValue> = [];
  const dates: Partial<Record<CandidateDateField, string | null>> = {};
  const dateEvidence = Object.fromEntries(
    DATE_FIELDS.map((field) => {
      const raw = candidate[field];
      const stored = candidate.dateEvidence?.[field];
      const sourceIdsForField = stored?.sourceIds ?? sourceIds;
      if (stored?.state === "explicit-null" && raw === null && stored.value === null) {
        dates[field] = null;
        return [
          field,
          { state: "explicit-null" as const, value: null, sourceIds: sourceIdsForField },
        ];
      }
      if (
        stored?.state === "value" &&
        isMachineDateValue(stored.value) &&
        (raw === undefined || raw === stored.value)
      ) {
        dates[field] = stored.value;
        return [
          field,
          { state: "value" as const, value: stored.value, sourceIds: sourceIdsForField },
        ];
      }
      if (
        stored?.state === "unknown" &&
        (raw === undefined || raw === null) &&
        (stored.value === undefined || stored.value === null)
      ) {
        dates[field] = null;
        return [field, { state: "unknown" as const, value: null, sourceIds: sourceIdsForField }];
      }
      if (isMachineDateValue(raw)) {
        dates[field] = raw;
        return [field, { state: "value" as const, value: raw, sourceIds: sourceIdsForField }];
      }
      if (raw !== undefined && raw !== null) {
        malformed.push({
          field,
          sourceId: sourceIdsForField[0] ?? sourceIds[0]!,
          state: "value",
          value: String(raw),
        });
      } else if (stored?.state === "value" && stored.value !== null && stored.value !== undefined) {
        malformed.push({
          field,
          sourceId: sourceIdsForField[0] ?? sourceIds[0]!,
          state: "value",
          value: String(stored.value),
        });
      }
      dates[field] = null;
      return [field, { state: "unknown" as const, value: null, sourceIds: sourceIdsForField }];
    }),
  ) as Record<CandidateDateField, CandidateDateEvidence>;
  const reviewIssue = appendMalformedDateEvidence(candidate.reviewIssue, malformed);
  return {
    ...candidate,
    ...dates,
    dateEvidence,
    ...(reviewIssue ? { reviewIssue } : {}),
    ...(malformed.length > 0 && candidate.ambiguity === null
      ? { ambiguity: "Incomplete date evidence requires review" }
      : {}),
  };
}

function appendMalformedDateEvidence(
  issue: CandidateReviewIssue | null | undefined,
  malformed: ReadonlyArray<CandidateReviewValue>,
): CandidateReviewIssue | null | undefined {
  if (malformed.length === 0) return issue;
  const fields = [
    ...new Set([...(issue?.fields ?? []), ...malformed.map((value) => value.field)]),
  ].sort();
  return {
    kind: issue?.kind ?? "ambiguous-evidence",
    fields,
    values: [...(issue?.values ?? []), ...malformed],
  };
}
