import { expect, test } from "bun:test";
import { healthSummary } from "../../src/health/summary";

test("failure health starts prominently and names failed courses", () => {
  const summary = healthSummary([
    { courseCode: "CS2030S", outcome: "success", finishedAt: "2026-09-03T04:03:00Z" },
    { courseCode: "IS1128", outcome: "failed", finishedAt: "2026-09-03T04:04:00Z" },
  ]);
  expect(summary).toStartWith("LAST SYNC FAILED");
  expect(summary).toContain("IS1128 failed at 12:04 pm");
});
