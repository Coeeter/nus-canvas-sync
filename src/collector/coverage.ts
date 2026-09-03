import { acceptedAlternates, COURSE_ENDPOINTS, type CourseCode } from "../config/courses";
import type { EndpointOutcomeSummary } from "../state/manifest";

export function courseCoverageSucceeded(
  course: CourseCode,
  endpoints: Readonly<Record<string, EndpointOutcomeSummary>>,
) {
  for (const [name, outcome] of Object.entries(endpoints)) {
    if (
      outcome.status === "TransientFailureError" ||
      outcome.status === "TaskAffectingFailureError"
    ) {
      return false;
    }
    if (outcome.status !== "CapabilityGapError") continue;

    if (!COURSE_ENDPOINTS.includes(name as (typeof COURSE_ENDPOINTS)[number])) return false;
    const alternates = acceptedAlternates(course, name as (typeof COURSE_ENDPOINTS)[number]);
    if (
      alternates.length === 0 ||
      alternates.some((alternate) => endpoints[alternate]?.status !== "ok")
    ) {
      return false;
    }
  }
  return true;
}
