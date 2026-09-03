import type { CourseCode } from "../config/courses";

export interface CourseHealth {
  courseCode: CourseCode;
  outcome: "success" | "failed";
  finishedAt: string;
}

export function healthSummary(courses: ReadonlyArray<CourseHealth>, timeZone = "Asia/Singapore") {
  const format = (value: string) =>
    new Intl.DateTimeFormat("en-SG", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    })
      .format(new Date(value))
      .toLowerCase();
  const successes = courses.filter((course) => course.outcome === "success");
  const failures = courses.filter((course) => course.outcome === "failed");
  const at = courses.at(-1)?.finishedAt ?? new Date().toISOString();
  if (failures.length === 0) {
    return `All ${successes.length} courses successfully synced at ${format(at)}.`;
  }
  return `LAST SYNC FAILED — ${successes.length} courses successfully synced at ${format(at)}; ${failures.map((course) => course.courseCode).join(", ")} failed at ${format(at)}.`;
}
