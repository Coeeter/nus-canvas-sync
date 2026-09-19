import type { CourseCode } from "../config/courses";
import type { NormalizedRecord } from "../normalize/types";
import type { CanonicalTaskContext } from "./types";

export interface CourseInterpretationInput {
  courseCode: CourseCode;
  courseContext: string;
  changedRecords: ReadonlyArray<NormalizedRecord>;
  referencedDocuments: ReadonlyArray<NormalizedRecord>;
  /** Compact deterministic inventory used to propose links without broad AI autonomy. */
  canonicalTasks?: ReadonlyArray<CanonicalTaskContext>;
  /** Unchanged source records that are relevant to canonical-link validation. */
  unchangedRecords?: ReadonlyArray<NormalizedRecord>;
}

export function buildCoursePrompt(input: CourseInterpretationInput, instructions: string) {
  return [
    instructions,
    `Course: ${input.courseCode}`,
    "Approved course context:",
    input.courseContext,
    "Changed source records:",
    JSON.stringify(input.changedRecords),
    "Referenced extracted documents:",
    JSON.stringify(input.referencedDocuments),
    "Current canonical task inventory (propose matchTaskId only when the evidence refers to one entry):",
    JSON.stringify(input.canonicalTasks ?? []),
    "Relevant unchanged canonical source records:",
    JSON.stringify(input.unchangedRecords ?? []),
  ].join("\n\n");
}
