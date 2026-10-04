import { expect, test } from "bun:test";
import { actionValues, planNotionDiff, planNotionSchema } from "../src/notion";
import type { Action } from "../src/types";

const action: Action = {
  id: "a",
  notionPageId: "p",
  action: "Quiz",
  course: "GEA1000",
  status: "Not started",
  availability: "Locked",
  weight: 5,
  startBy: null,
  due: "2026-09-20",
  source: "https://canvas.nus.edu.sg/x",
  notes: "",
  archived: false,
  origin: "agent",
  term: "Term",
  createdAt: "now",
  updatedAt: "now",
};

test("identical Notion projection emits no write", () => {
  expect(
    planNotionDiff(
      [action],
      [
        {
          pageId: "p",
          values: {
            action: "Quiz",
            course: "GEA1000",
            status: "Not started",
            availability: "Locked",
            weight: 5,
            startBy: null,
            due: "2026-09-20",
            source: "https://canvas.nus.edu.sg/x",
            notes: "",
            archived: false,
          },
        },
      ],
    ),
  ).toEqual([]);
});

test("Notion date-time formatting does not cause repeat writes", () => {
  const dated = { ...action, due: "2026-11-05T16:00:00+08:00" };
  const row = {
    pageId: "p",
    values: {
      action: "Quiz",
      course: "GEA1000",
      status: "Not started" as const,
      availability: "Locked" as const,
      weight: 5,
      startBy: null,
      due: "2026-11-05T16:00:00.000+08:00",
      source: "https://canvas.nus.edu.sg/x",
      notes: "",
      archived: false,
    },
  };
  expect(planNotionDiff([dated], [row])).toEqual([]);
  expect(planNotionDiff([{ ...dated, due: "2026-11-05T08:00:00Z" }], [row])).toEqual([]);
  expect(planNotionDiff([{ ...dated, due: "2026-11-05" }], [row])).toHaveLength(1);
});

test("Notion minute precision does not leave four deadline updates pending", () => {
  const dates = ["2026-10-11", "2026-11-01", "2026-11-15", "2026-11-19"];
  const actions = dates.map((date, index) => ({
    ...action,
    id: `action-${index}`,
    notionPageId: `page-${index}`,
    startBy: `${date}T09:00:30+08:00`,
    due: `${date}T23:59:59+08:00`,
  }));
  const rows = actions.map((item, index) => ({
    pageId: item.notionPageId,
    values: {
      ...actionValues(item),
      startBy: `${dates[index]}T01:00:00.000Z`,
      due: `${dates[index]}T15:59:00.000Z`,
    },
  }));

  expect(planNotionDiff(actions, rows)).toEqual([]);
  expect(actions[0]?.due).toBe("2026-10-11T23:59:59+08:00");
});

test("Notion minute precision still detects different minutes and date-only values", () => {
  const dated = {
    ...action,
    startBy: "2026-10-11T09:00:30+08:00",
    due: "2026-10-11T23:59:59+08:00",
  };
  const row = { pageId: "p", values: actionValues(dated) };

  for (const change of [
    { due: "2026-10-12T00:00:00+08:00" },
    { startBy: "2026-10-11T09:01:00+08:00" },
    { due: "2026-10-11" },
    { startBy: null },
  ]) {
    expect(
      planNotionDiff([dated], [{ ...row, values: { ...row.values, ...change } }]),
    ).toHaveLength(1);
  }
});

test("changed availability updates the existing row rather than creating review copy", () => {
  const operations = planNotionDiff(
    [{ ...action, availability: "Review" }],
    [
      {
        pageId: "p",
        values: {
          action: "Quiz",
          course: "GEA1000",
          status: "Not started",
          availability: "Locked",
          weight: 5,
          startBy: null,
          due: "2026-09-20",
          source: "https://canvas.nus.edu.sg/x",
          notes: "",
          archived: false,
        },
      },
    ],
  );
  expect(operations).toHaveLength(1);
  expect(operations[0]).toMatchObject({ type: "update", pageId: "p" });
});

test("an already archived Notion page stays absent from the published projection", () => {
  expect(planNotionDiff([{ ...action, archived: true }], [])).toEqual([]);
});

test("schema dry-run exposes additions, removals, and unsafe type changes", () => {
  expect(
    planNotionSchema({
      Action: { type: "title" },
      Course: { type: "select" },
      Status: { type: "status" },
      "Canvas ID": { type: "rich_text" },
    }),
  ).toEqual({
    add: ["Availability", "Weight", "Start By", "Due", "Source", "Notes"],
    remove: ["Canvas ID"],
    wrongType: ["Status"],
    wrongOptions: ["Status", "Availability"],
  });
});

test("schema dry-run rejects stale workflow options", () => {
  const schema = {
    Action: { type: "title" },
    Course: { type: "select" },
    Status: {
      type: "select",
      select: {
        options: ["Not started", "Doing", "Waiting", "Done", "Dropped", "In progress"].map(
          (name) => ({ name }),
        ),
      },
    },
    Availability: {
      type: "select",
      select: { options: ["Locked", "Ready", "Blocked", "Review"].map((name) => ({ name })) },
    },
    Weight: { type: "number" },
    "Start By": { type: "date" },
    Due: { type: "date" },
    Source: { type: "url" },
    Notes: { type: "rich_text" },
  };

  expect(planNotionSchema(schema).wrongOptions).toEqual(["Status"]);
});
