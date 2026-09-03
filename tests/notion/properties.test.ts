import { expect, test } from "bun:test";
import { encodeNotionProperties, readNotionText } from "../../src/notion/properties";

test("encodes only the live Actions property shapes", () => {
  expect(
    encodeNotionProperties({
      Action: "Quiz",
      Course: "IS1128",
      "Needs Review": true,
      "Official Due": "2026-09-06T23:59:00+08:00",
    }),
  ).toEqual({
    Action: { title: [{ type: "text", text: { content: "Quiz" } }] },
    Course: { select: { name: "IS1128" } },
    "Needs Review": { checkbox: true },
    "Official Due": { date: { start: "2026-09-06T23:59:00+08:00" } },
  });
});

test("reads the stable identity from a Notion rich-text property", () => {
  expect(readNotionText({ rich_text: [{ plain_text: "course:1:quiz:2" }] })).toBe(
    "course:1:quiz:2",
  );
});
