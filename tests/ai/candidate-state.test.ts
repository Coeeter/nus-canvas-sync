import { expect, test } from "bun:test";
import { mergeCandidateEnvelopes } from "../../src/ai/state";
import type { CourseCandidate } from "../../src/ai/types";

const candidate = (title: string, sourceIds: Array<string>): CourseCandidate => ({
  courseCode: "IS1128",
  sourceIds,
  evidence: title,
  kind: "preparation",
  title,
  requiredAction: title,
  confidence: 0.95,
  ambiguity: null,
});

test("unchanged candidates persist while affected candidates are replaced", () => {
  const retained = candidate("Retained", ["source:1"]);
  const replaced = candidate("Old", ["source:2"]);
  const fresh = candidate("New", ["source:2", "document:2"]);

  expect(
    mergeCandidateEnvelopes(
      { candidates: [retained, replaced] },
      { candidates: [fresh] },
      new Set(["source:2"]),
    ),
  ).toEqual({ candidates: [retained, fresh] });
});
