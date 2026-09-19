import { expect, test } from "bun:test";
import { mergeCandidateEnvelopes, migrateCandidateEnvelope } from "../../src/ai/state";
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

test("legacy nullable dates migrate to unknown, never explicit removal", () => {
  const legacy = candidate("Legacy", ["source:1"]);
  const migrated = migrateCandidateEnvelope({ candidates: [legacy] }).candidates[0]!;
  expect(migrated.dateEvidence?.dueAt).toEqual({
    state: "unknown",
    value: null,
    sourceIds: ["source:1"],
  });
});

test("legacy malformed dates become unknown review evidence without reaching planning", () => {
  const legacy = {
    ...candidate("Legacy", ["source:1"]),
    dueAt: "September 30",
  };
  const migrated = migrateCandidateEnvelope({ candidates: [legacy] }).candidates[0]!;
  expect(migrated.dueAt).toBe(null);
  expect(migrated.dateEvidence?.dueAt).toEqual({
    state: "unknown",
    value: null,
    sourceIds: ["source:1"],
  });
  expect(migrated.reviewIssue?.values).toContainEqual(
    expect.objectContaining({ field: "dueAt", value: "September 30" }),
  );
});
