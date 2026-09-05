import type { CourseCode } from "../config/courses";
import type { TaskKind } from "../domain/task";

export interface CourseCandidate {
  courseCode: CourseCode;
  sourceIds: ReadonlyArray<string>;
  evidence: string;
  actionKey?: string | undefined;
  identity?: string | undefined;
  relationship?: "action" | "enrichment" | undefined;
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
  candidates: ReadonlyArray<CourseCandidate>;
}
