import type { SemesterConfig } from "./types";

export async function readSemester(path = "config/semester.json"): Promise<SemesterConfig> {
  const value = (await Bun.file(path).json()) as SemesterConfig;
  if (
    !value.term ||
    !value.timezone ||
    !value.dashboard?.pageId ||
    !value.dashboard?.syncStatusBlockId ||
    !Array.isArray(value.courses) ||
    value.courses.length === 0
  ) {
    throw new Error(`Invalid semester configuration: ${path}`);
  }
  const codes = new Set<string>();
  for (const course of value.courses) {
    if (
      !course.code ||
      !course.name ||
      !Number.isInteger(course.canvasId) ||
      !Array.isArray(course.structure) ||
      course.structure.length === 0
    ) {
      throw new Error(`Invalid course configuration in ${path}`);
    }
    if (codes.has(course.code)) throw new Error(`Duplicate course code: ${course.code}`);
    codes.add(course.code);
  }
  return value;
}

export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Missing environment variable: ${name}`);
  return value;
}
