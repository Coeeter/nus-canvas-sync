import { describe, expect, test } from "bun:test";
import type { CanvasFile } from "../../schemas/canvas.schema";
import {
  hasDownloadableUrl,
  isExtractableDocument,
  referencedByForFile,
  selectRelevantFiles,
} from "../../src/collector/documents";
import { COURSES } from "../../src/config/courses";
import { normalizeDocument } from "../../src/normalize/records";
import type { NormalizedRecord } from "../../src/normalize/types";

const course = COURSES.find((candidate) => candidate.code === "IS1128")!;

function file(id: number, display_name: string): CanvasFile {
  return {
    id,
    display_name,
    url: `https://canvas.nus.edu.sg/files/${id}/download`,
    updated_at: null,
  };
}

describe("selectRelevantFiles", () => {
  test("selects a file referenced by id in changed prose", () => {
    const files = [file(1, "week3.jpg"), file(2, "supplementary.zip")];
    const selected = selectRelevantFiles(files, ["see attached: /files/1/download"]);
    expect(selected.map((f) => f.id)).toEqual([1]);
  });

  test("selects a recognisable brief/spec/rubric filename even without a prose reference", () => {
    const files = [file(1, "Project Brief.pdf"), file(2, "unrelated.jpg")];
    const selected = selectRelevantFiles(files, []);
    expect(selected.map((f) => f.id)).toEqual([1]);
  });

  test("selects assignment and numbered tutorial documents referenced by filename", () => {
    const files = [
      file(1, "GEA1000 Video Assignment.pdf"),
      file(2, "Tutorial 2.pdf"),
      file(3, "Ch 1 Study Designs - Random Assignment - Student's Notes.pdf"),
    ];
    const selected = selectRelevantFiles(files, [
      "The GEA1000 Video Assignment document is available. Work through Tutorial 2 before class.",
    ]);
    expect(selected.map((f) => f.id)).toEqual([1, 2]);
  });

  test("does not select files that are neither referenced nor recognisable (SRC-006)", () => {
    const files = [file(1, "meme.jpg")];
    const selected = selectRelevantFiles(files, ["totally unrelated announcement text"]);
    expect(selected).toEqual([]);
  });

  test("preserves stable source relationships on normalized documents", () => {
    const source = {
      id: `course:${course.id}:announcement:9`,
      courseCode: course.code,
      kind: "announcement",
      sourceUrl: null,
      contentHash: "hash",
      fields: { message: "See /files/1/download" },
    } satisfies NormalizedRecord;
    const references = referencedByForFile(file(1, "brief.pdf"), [source]);
    const document = normalizeDocument(course, file(1, "brief.pdf"), "requirements", references);

    expect(document.fields.fileSourceId).toBe(`course:${course.id}:file:1`);
    expect(document.fields.referencedBy).toEqual([source.id]);
  });

  test("treats an exact filename mention as a stable source relationship", () => {
    const source = {
      id: `course:${course.id}:announcement:10`,
      courseCode: course.code,
      kind: "announcement",
      sourceUrl: null,
      contentHash: "hash",
      fields: { message: "The GEA1000 Video Assignment document is now available." },
    } satisfies NormalizedRecord;

    expect(referencedByForFile(file(2, "GEA1000 Video Assignment.pdf"), [source])).toEqual([
      source.id,
    ]);
  });

  test("does not treat a module file listing as a prose filename reference", () => {
    const module = {
      id: `course:${course.id}:module:10`,
      courseCode: course.code,
      kind: "module",
      sourceUrl: null,
      contentHash: "hash",
      fields: { items: [{ title: "GEA1000 Video Assignment.pdf" }] },
    } satisfies NormalizedRecord;

    expect(referencedByForFile(file(2, "GEA1000 Video Assignment.pdf"), [module])).toEqual([]);
  });
});

describe("isExtractableDocument", () => {
  test("accepts text-bearing formats and rejects images, archives, and spreadsheets", () => {
    expect(isExtractableDocument(file(1, "brief.pdf"))).toBe(true);
    expect(isExtractableDocument(file(2, "notes.md"))).toBe(true);
    expect(isExtractableDocument(file(3, "screenshot.png"))).toBe(false);
    expect(isExtractableDocument(file(4, "data.zip"))).toBe(false);
    expect(isExtractableDocument(file(5, "answers.xlsx"))).toBe(false);
  });
});

describe("hasDownloadableUrl", () => {
  test("a future/locked file with a blank url is not downloadable", () => {
    expect(hasDownloadableUrl(file(1, "future.pdf"))).toBe(true);
    expect(hasDownloadableUrl({ ...file(1, "future.pdf"), url: "" })).toBe(false);
    expect(hasDownloadableUrl({ ...file(1, "future.pdf"), url: "   " })).toBe(false);
  });
});
