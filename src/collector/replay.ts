import { existsSync, readFileSync } from "node:fs";
import { Schema } from "effect";
import { assignmentListSchema } from "../../schemas/canvas.schema";
import { COURSES, type CourseCode } from "../config/courses";
import { computeDiff } from "../diff/compute";
import { normalizeAssignment } from "../normalize/records";

/**
 * Replays a fixture pair (`<dir>/before/<course>.json`, `<dir>/after/<course>.json`,
 * each a raw Canvas assignment array) through normalize + diff, proving the
 * pipeline is deterministic and schema-honest without any network call
 * (Phase 1's `fixture:replay` validation tier). Assignments stand in for the
 * other record kinds, which share the same normalize→hash→diff shape.
 */
export function replayFixtures(dir: string) {
  const results: Partial<Record<CourseCode, ReturnType<typeof computeDiff>>> = {};

  for (const course of COURSES) {
    const beforePath = `${dir}/before/${course.code}.json`;
    const afterPath = `${dir}/after/${course.code}.json`;
    const before = readAssignments(beforePath);
    const after = readAssignments(afterPath);
    if (!before || !after) continue;

    const previous = before.map((a) => normalizeAssignment(course, a));
    const current = after.map((a) => normalizeAssignment(course, a));
    results[course.code] = computeDiff(previous, current);
  }

  return results;
}

function readAssignments(path: string) {
  if (!existsSync(path)) return null;
  const json: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Schema.decodeUnknownSync(assignmentListSchema)(json);
}
