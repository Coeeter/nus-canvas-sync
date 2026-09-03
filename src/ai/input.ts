import type { CourseCode } from "../config/courses";
import type { NormalizedRecord } from "../normalize/types";

export interface CourseInterpretationInput {
  courseCode: CourseCode;
  courseContext: string;
  changedRecords: ReadonlyArray<NormalizedRecord>;
  referencedDocuments: ReadonlyArray<NormalizedRecord>;
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
  ].join("\n\n");
}
