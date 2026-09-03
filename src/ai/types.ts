import type { CourseCode } from "../config/courses";
import type { TaskKind } from "../domain/task";

export interface CourseCandidate {
  courseCode: CourseCode;
  sourceIds: Array<string>;
  evidence: string;
  kind: TaskKind;
  title: string;
  requiredAction: string;
  availableFrom?: string | null;
  dueAt?: string | null;
  eventEndsAt?: string | null;
  confidence: number;
  ambiguity: string | null;
}

export interface CandidateEnvelope {
  candidates: Array<CourseCandidate>;
}
