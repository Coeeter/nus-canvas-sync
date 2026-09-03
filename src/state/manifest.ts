import { Either } from "effect";
import type { EndpointResult } from "../collector/types";
import type { CourseCode } from "../config/courses";

export interface EndpointOutcomeSummary {
  status: "ok" | "CapabilityGapError" | "TransientFailureError" | "TaskAffectingFailureError";
  detail?: string;
  count?: number;
}

/** DIF-006: a manifest entry never carries raw data or secret values, only the outcome shape. */
export function summarizeResult<A>(result: EndpointResult<A>): EndpointOutcomeSummary {
  return Either.match(result, {
    onLeft: (failure) => {
      switch (failure._tag) {
        case "CapabilityGapError":
          return { status: "CapabilityGapError", detail: failure.reason };
        case "TransientFailureError":
          return { status: "TransientFailureError", detail: failure.message };
        case "TaskAffectingFailureError":
          return { status: "TaskAffectingFailureError", detail: failure.message };
      }
    },
    onRight: (data) => ({ status: "ok", count: Array.isArray(data) ? data.length : 1 }),
  });
}

export interface CourseManifestEntry {
  courseCode: CourseCode;
  endpoints: Record<string, EndpointOutcomeSummary>;
  diff: { added: number; changed: number; removed: number };
  outcome: "success" | "failed";
}

export interface RunManifest {
  runId: string;
  startedAt: string;
  finishedAt: string;
  courses: Array<CourseManifestEntry>;
  planner: EndpointOutcomeSummary;
  github: Record<string, EndpointOutcomeSummary>;
}
