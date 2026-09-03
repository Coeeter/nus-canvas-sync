import { expect, test } from "bun:test";
import type { NormalizedRecord } from "../../src/normalize/types";
import { factsFromRecords } from "../../src/projector/from-records";

const base = (overrides: Partial<NormalizedRecord>): NormalizedRecord => ({
  id: "course:1:assignment:1",
  courseCode: "CS2030S",
  kind: "assignment",
  sourceUrl: "https://canvas.example/1",
  contentHash: "hash",
  fields: {
    name: "Diagnostic 02",
    unlockAt: null,
    dueAt: null,
    submission: { workflowState: "graded", grade: "5" },
  },
  ...overrides,
});

test("Canvas completion and optional diagnostics become deterministic facts", () => {
  const [completed, optional] = factsFromRecords([
    base({}),
    base({
      id: "course:1:assignment:2",
      fields: { name: "Practice Diagnostic 02", submission: null },
    }),
  ]);
  expect(completed?.completed).toBe(true);
  expect(optional?.kind).toBe("optional");
});

test("released GESS1001 module lecture parts become e-lecture facts", () => {
  const facts = factsFromRecords([
    base({
      id: "course:2:module:1",
      courseCode: "GESS1001",
      kind: "module",
      fields: {
        name: "Week 3",
        published: true,
        items: [{ id: 8, title: "Recorded Lecture Part 1", published: true, unlockAt: null }],
      },
    }),
  ]);
  expect(facts[0]).toMatchObject({ kind: "e-lecture", week: 3, observed: true });
});
