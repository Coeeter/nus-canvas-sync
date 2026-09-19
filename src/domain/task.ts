import type { CourseCode } from "../config/courses";

export type TaskKind = "assessment" | "preparation" | "e-lecture" | "physical-event" | "optional";
export type TaskState =
  | "expected"
  | "locked"
  | "waiting"
  | "scheduled"
  | "ready"
  | "done"
  | "expired"
  | "review"
  | "inactive";
export type UserStatus = "Not started" | "In progress" | "Done" | "Dropped";

export interface TaskConflictIssue {
  kind: string;
  field?: string;
  /** Canonical affected-field set; `field` is retained for legacy consumers. */
  fields?: ReadonlyArray<string>;
  values?: ReadonlyArray<unknown>;
}

export interface TaskFact {
  id: string;
  /** Stable logical identity. It is independent of mutable title/evidence wording. */
  logicalKey?: string;
  /** Old candidate ids and source identities retained for migration/reconciliation. */
  aliases?: ReadonlyArray<string>;
  courseCode: CourseCode;
  kind: TaskKind;
  title: string;
  sourceIds: ReadonlyArray<string>;
  sourceUrl?: string | null;
  observed: boolean;
  authoritativeAction?: boolean;
  availableFrom?: string | null;
  dueAt?: string | null;
  eventEndsAt?: string | null;
  completed?: boolean;
  scheduled?: boolean;
  workMode?: "Flexible" | "Before class" | "During class" | "Online";
  blockedBy?: string | null;
  userStatus?: UserStatus;
  /** Raw source-backed Notion proposal carried through planning, not user state. */
  sourceProposal?: Readonly<Record<string, unknown>>;
  conflict?: {
    reason: string;
    sources: ReadonlyArray<string>;
    issue?: TaskConflictIssue;
  };
  reviewResolution?: { revision: string; overrides: Record<string, unknown> };
  week?: number;
}

export interface TaskProjection extends TaskFact {
  state: TaskState;
  actionable: boolean;
  needsReview: boolean;
  reason: string | null;
  memberSourceIds: ReadonlyArray<string>;
}
