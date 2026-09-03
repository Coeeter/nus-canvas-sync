import type { CourseCode } from "../../src/config/courses";

export interface CourseRule {
  lectureMode: "physical" | "self-paced";
}

export const COURSE_RULES: Record<CourseCode, CourseRule> = {
  CS2030S: { lectureMode: "physical" },
  GEA1000: { lectureMode: "self-paced" },
  GESS1001: { lectureMode: "self-paced" },
  IS1128: { lectureMode: "physical" },
  MA1301: { lectureMode: "physical" },
};
