import type { CourseCode } from "../config/courses";
import type { TaskKind } from "../domain/task";

export type CandidateDateField = "availableFrom" | "dueAt" | "eventEndsAt";
export type CandidateDateState = "unknown" | "value" | "explicit-null";

/**
 * The nullable date fields below are retained for compatibility with old
 * caches. New model output must use this companion object to say whether null
 * means unknown or an authoritative removal.
 */
export interface CandidateDateEvidence {
  state: CandidateDateState;
  value?: string | null | undefined;
  sourceIds: ReadonlyArray<string>;
}

export interface CandidateReviewValue {
  field: CandidateDateField | "evidence";
  sourceId: string;
  state: CandidateDateState;
  value?: string | null | undefined;
}

export interface CandidateReviewIssue {
  kind:
    | "missing-class-time"
    | "conflicting-class-time"
    | "conflicting-deadline"
    | "conflicting-release"
    | "ambiguous-evidence"
    | "other";
  fields: ReadonlyArray<CandidateDateField | "evidence">;
  values: ReadonlyArray<CandidateReviewValue>;
}

export interface CourseCandidate {
  courseCode: CourseCode;
  sourceIds: ReadonlyArray<string>;
  evidence: string;
  kind: TaskKind;
  title: string;
  requiredAction: string;
  availableFrom?: string | null;
  dueAt?: string | null;
  eventEndsAt?: string | null;
  dateEvidence?:
    | {
        availableFrom: CandidateDateEvidence;
        dueAt: CandidateDateEvidence;
        eventEndsAt: CandidateDateEvidence;
      }
    | undefined;
  confidence: number;
  ambiguity: string | null;
  reviewIssue?: CandidateReviewIssue | null | undefined;
  /** AI may link prose evidence to a current canonical task; code validates the link. */
  matchTaskId?: string | null | undefined;
  /** Stable key for a derived task when no canonical Canvas assessment exists. */
  logicalKey?: string | null | undefined;
}

export interface CandidateEnvelope {
  candidates: ReadonlyArray<CourseCandidate>;
}

export interface CanonicalTaskContext {
  id: string;
  courseCode: CourseCode;
  kind: TaskKind;
  title: string;
  sourceIds: ReadonlyArray<string>;
  logicalKey?: string | undefined;
}
