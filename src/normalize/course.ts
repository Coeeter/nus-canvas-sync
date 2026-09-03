import { Either } from "effect";
import type {
  CanvasAnnouncement,
  CanvasAssignment,
  CanvasFile,
  CanvasModule,
  CanvasPageBody,
  CanvasQuiz,
} from "../../schemas/canvas.schema";
import type { EndpointResult } from "../collector/types";
import type { Course } from "../config/courses";
import {
  normalizeAnnouncement,
  normalizeAssignment,
  normalizeFile,
  normalizeModule,
  normalizePage,
  normalizeQuiz,
} from "./records";
import type { NormalizedRecord } from "./types";

export interface CourseEndpointResults {
  assignments: EndpointResult<ReadonlyArray<CanvasAssignment>>;
  quizzes: EndpointResult<ReadonlyArray<CanvasQuiz>>;
  announcements: EndpointResult<ReadonlyArray<CanvasAnnouncement>>;
  files: EndpointResult<ReadonlyArray<CanvasFile>>;
  modules: EndpointResult<ReadonlyArray<CanvasModule>>;
  frontPage: EndpointResult<CanvasPageBody>;
  pageBodies: ReadonlyArray<EndpointResult<CanvasPageBody>>;
}

const orEmpty = <A>(result: EndpointResult<ReadonlyArray<A>>) => Either.getOrElse(result, () => []);

/** Normalizes only the endpoints that succeeded; failures are reported separately via the run manifest (SRC-004). */
export function normalizeCourseRecords(course: Course, results: CourseEndpointResults) {
  const records: Array<NormalizedRecord> = [];
  records.push(...orEmpty(results.assignments).map((a) => normalizeAssignment(course, a)));
  records.push(...orEmpty(results.quizzes).map((q) => normalizeQuiz(course, q)));
  records.push(...orEmpty(results.announcements).map((a) => normalizeAnnouncement(course, a)));
  records.push(...orEmpty(results.files).map((f) => normalizeFile(course, f)));
  records.push(...orEmpty(results.modules).map((m) => normalizeModule(course, m)));
  if (Either.isRight(results.frontPage))
    records.push(normalizePage(course, results.frontPage.right));
  for (const pageResult of results.pageBodies) {
    if (Either.isRight(pageResult)) records.push(normalizePage(course, pageResult.right));
  }
  return records;
}
