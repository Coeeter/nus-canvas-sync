import { expect, test } from "bun:test";
import { moduleReferences, shouldDownloadFile } from "../src/canvas";

test("collector selects small assessment documents, not large reference material", () => {
  expect(shouldDownloadFile("IS1128 Project specification.pdf", 600_000)).toBe(true);
  expect(shouldDownloadFile("Kickstart report-full year-digital.pdf", 40_943_891)).toBe(false);
  expect(shouldDownloadFile("MA1301 Lecture Notes.pdf", 3_000_000)).toBe(false);
});

test("module links expose pages and files when course-wide listings are unavailable", () => {
  const modules = [
    {
      state: "unlocked",
      items: [
        { type: "Page", page_url: "assessment-dates" },
        { type: "File", content_id: 9782348 },
      ],
    },
    { state: "locked", items: [{ type: "Page", page_url: "future-week" }] },
  ];
  expect(moduleReferences(modules)).toEqual({ pageUrls: ["assessment-dates"], fileIds: [9782348] });
});
