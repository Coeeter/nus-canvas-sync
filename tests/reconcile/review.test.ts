import { expect, test } from "bun:test";
import { resolveReviewedCandidate } from "../../src/reconcile/review";

const fact = {
  id: "candidate",
  courseCode: "GESS1001" as const,
  kind: "assessment" as const,
  title: "Article",
  sourceIds: ["brief", "syllabus"],
  observed: true,
  authoritativeAction: true,
  conflict: { reason: "deadlines disagree", sources: ["brief", "syllabus"] },
};

test("rejected candidates disappear and unsafe accepted candidates return to review", () => {
  expect(
    resolveReviewedCandidate(fact, { needsReview: true, status: "Dropped" }, new Date()),
  ).toBeNull();
  expect(
    resolveReviewedCandidate(fact, { needsReview: false, status: "Not started" }, new Date())
      ?.state,
  ).toBe("review");
});
