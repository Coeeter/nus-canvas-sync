import { describe, expect, test } from "bun:test";
import { computeDiff } from "../../src/diff/compute";
import type { NormalizedRecord } from "../../src/normalize/types";

function record(id: string, contentHash: string): NormalizedRecord {
  return {
    id,
    courseCode: "CS2030S",
    kind: "assignment",
    sourceUrl: null,
    contentHash,
    fields: {},
  };
}

describe("computeDiff", () => {
  test("reports added, changed, and removed by identity and content hash", () => {
    const previous = [record("a", "h1"), record("b", "h1")];
    const current = [record("a", "h1"), record("b", "h2"), record("c", "h1")];

    const diff = computeDiff(previous, current);

    expect(diff.added.map((r) => r.id)).toEqual(["c"]);
    expect(diff.changed.map((c) => c.after.id)).toEqual(["b"]);
    expect(diff.removed).toEqual([]);
  });

  test("an unchanged record produces no diff, even if response ordering changes", () => {
    const previous = [record("a", "h1"), record("b", "h1")];
    const current = [record("b", "h1"), record("a", "h1")];

    const diff = computeDiff(previous, current);

    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  test("a record missing from the current snapshot is removed", () => {
    const previous = [record("a", "h1"), record("b", "h1")];
    const current = [record("a", "h1")];

    const diff = computeDiff(previous, current);

    expect(diff.removed.map((r) => r.id)).toEqual(["b"]);
  });
});
