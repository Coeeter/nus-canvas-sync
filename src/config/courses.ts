export const COURSES = [
  { id: 93698, code: "CS2030S" },
  { id: 94257, code: "GEA1000" },
  { id: 94548, code: "GESS1001" },
  { id: 97325, code: "IS1128" },
  { id: 97359, code: "MA1301" },
] as const;

export type Course = (typeof COURSES)[number];
export type CourseCode = Course["code"];

export const COURSE_ENDPOINTS = [
  "assignments",
  "quizzes",
  "announcements",
  "files",
  "modules",
  "frontPage",
  "pages",
] as const;

export type CourseEndpoint = (typeof COURSE_ENDPOINTS)[number];

/**
 * SRC-005: a course may declare an endpoint as a known capability gap, naming
 * the other declared endpoints that are accepted as alternate evidence. An
 * endpoint absent from `gaps` is required; its failure is always
 * task-affecting. No gaps are declared yet for any course — none has been
 * observed and confirmed in production. Add an entry here only once a
 * specific course/endpoint 404 has been confirmed against live Canvas.
 */
export interface CourseCapabilities {
  gaps: Partial<Record<CourseEndpoint, ReadonlyArray<CourseEndpoint>>>;
  acceptedFailures?: Partial<Record<CourseEndpoint, ReadonlyArray<"not-found" | "auth">>>;
}

const NO_KNOWN_GAPS: CourseCapabilities = { gaps: {} };

export const COURSE_CAPABILITIES: Record<CourseCode, CourseCapabilities> = {
  CS2030S: NO_KNOWN_GAPS,
  GEA1000: {
    gaps: { pages: ["modules"] },
    acceptedFailures: { pages: ["not-found"] },
  },
  GESS1001: {
    gaps: {
      files: ["modules", "announcements"],
      frontPage: ["modules", "announcements"],
      pages: ["modules"],
      quizzes: ["assignments", "modules", "announcements"],
    },
    acceptedFailures: {
      files: ["auth"],
      frontPage: ["not-found"],
      pages: ["not-found"],
      quizzes: ["not-found"],
    },
  },
  IS1128: NO_KNOWN_GAPS,
  MA1301: {
    gaps: { quizzes: ["assignments", "modules"] },
    acceptedFailures: { quizzes: ["not-found"] },
  },
};

export function isRequiredEndpoint(
  course: CourseCode,
  endpoint: CourseEndpoint,
  capabilities: Record<CourseCode, CourseCapabilities> = COURSE_CAPABILITIES,
) {
  return !(endpoint in capabilities[course].gaps);
}

export function acceptedAlternates(
  course: CourseCode,
  endpoint: CourseEndpoint,
  capabilities: Record<CourseCode, CourseCapabilities> = COURSE_CAPABILITIES,
) {
  return capabilities[course].gaps[endpoint] ?? [];
}

export function acceptsGapFailure(
  course: CourseCode,
  endpoint: CourseEndpoint,
  failure: "not-found" | "auth",
  capabilities: Record<CourseCode, CourseCapabilities> = COURSE_CAPABILITIES,
) {
  const configured = capabilities[course].acceptedFailures?.[endpoint];
  if (configured) return configured.includes(failure);
  return failure === "not-found" && endpoint in capabilities[course].gaps;
}

export const SEMESTER_WINDOW = { startDate: "2026-07-19", endDate: "2027-01-10" };
