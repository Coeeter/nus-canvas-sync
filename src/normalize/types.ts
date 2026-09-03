import type { CourseCode } from "../config/courses";

export type RecordKind =
  | "assignment"
  | "quiz"
  | "announcement"
  | "module"
  | "page"
  | "file"
  | "document"
  | "planner-item"
  | "github-repo"
  | "github-commit";

/**
 * SRC-002: a stable identity of the form `course:<course-id>:<kind>:<source-id>`,
 * a source URL, and a content hash computed from canonical task-relevant
 * fields only (transport noise and response ordering are excluded).
 */
export interface NormalizedRecord {
  id: string;
  courseCode: CourseCode;
  kind: RecordKind;
  sourceUrl: string | null;
  contentHash: string;
  fields: Record<string, unknown>;
}

export function sourceId(courseId: number, kind: RecordKind, sourceId_: string | number) {
  return `course:${courseId}:${kind}:${sourceId_}`;
}
