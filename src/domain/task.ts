import type { CourseCode } from "../config/courses";

export type TaskKind = "assessment" | "preparation" | "e-lecture" | "physical-event" | "optional";
export type TaskState =
  | "expected"
  | "locked"
  | "ready"
  | "done"
  | "expired"
  | "review"
  | "inactive";
export type UserStatus = "Not started" | "In progress" | "Done" | "Dropped";

export interface TaskFact {
  id: string;
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
  userStatus?: UserStatus;
  conflict?: { reason: string; sources: ReadonlyArray<string> };
  week?: number;
}

export interface TaskProjection extends TaskFact {
  state: TaskState;
  actionable: boolean;
  needsReview: boolean;
  reason: string | null;
  memberSourceIds: ReadonlyArray<string>;
}
