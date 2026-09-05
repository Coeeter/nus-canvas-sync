import { expect, test } from "bun:test";
import { affectedInterpretation } from "../../src/ai/affected";
import type { NormalizedRecord } from "../../src/normalize/types";

const record = (
  id: string,
  kind: NormalizedRecord["kind"],
  fields: Record<string, unknown>,
): NormalizedRecord => ({
  id,
  kind,
  fields,
  courseCode: "IS1128",
  contentHash: "fixture",
  sourceUrl: null,
});
test("changed brief keeps its unchanged announcement and excludes unrelated prose; submissions alone skip extraction", () => {
  const assignment = record("course:97325:assignment:1", "assignment", {
    name: "Quiz",
    description: "Attempt",
    submission: { workflowState: "unsubmitted" },
  });
  const announcement = record("course:97325:announcement:2", "announcement", {
    message: "Read /files/9",
  });
  const brief = record("course:97325:document:9", "document", {
    text: "Old instructions",
    referencedBy: [announcement.id],
  });
  const unrelated = record("course:97325:announcement:3", "announcement", {
    message: "Other work",
  });
  const previous = [assignment, announcement, brief, unrelated];
  const current = [
    assignment,
    announcement,
    { ...brief, fields: { ...brief.fields, text: "New instructions" } },
    unrelated,
  ];
  expect(
    affectedInterpretation(previous, current, { candidates: [] }).records.map(
      (record) => record.id,
    ),
  ).toEqual([announcement.id, brief.id]);
  expect(
    affectedInterpretation(
      previous,
      [
        {
          ...assignment,
          fields: { ...assignment.fields, submission: { workflowState: "submitted" } },
        },
        ...previous.slice(1),
      ],
      { candidates: [] },
    ).records,
  ).toEqual([]);
});
