import { describe, expect, test } from "bun:test";
import { courseCoverageSucceeded } from "../../src/collector/coverage";
import type { EndpointOutcomeSummary } from "../../src/state/manifest";

const ok = { status: "ok", count: 1 } as const;
const hard = { status: "TaskAffectingFailureError", detail: "failed" } as const;
const transient = { status: "TransientFailureError", detail: "retry later" } as const;
const gap = { status: "CapabilityGapError", detail: "declared gap" } as const;

function endpoints(
  overrides: Partial<Record<string, EndpointOutcomeSummary>> = {},
): Record<string, EndpointOutcomeSummary> {
  return {
    assignments: ok,
    quizzes: ok,
    announcements: ok,
    files: ok,
    modules: ok,
    frontPage: ok,
    pages: ok,
    ...overrides,
  };
}

describe("courseCoverageSucceeded", () => {
  test("rejects transient and selected-document failures instead of reporting success", () => {
    expect(courseCoverageSucceeded("CS2030S", endpoints({ assignments: transient }))).toBe(false);
    expect(courseCoverageSucceeded("CS2030S", endpoints({ "document:9": hard }))).toBe(false);
  });

  test("accepts a declared gap only when every declared alternate succeeded", () => {
    expect(
      courseCoverageSucceeded(
        "GESS1001",
        endpoints({ files: gap, modules: ok, announcements: ok }),
      ),
    ).toBe(true);
    expect(
      courseCoverageSucceeded(
        "GESS1001",
        endpoints({ files: gap, modules: ok, announcements: transient }),
      ),
    ).toBe(false);
  });
});
