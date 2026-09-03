import { describe, expect, test } from "bun:test";
import type { CanvasFile } from "../../schemas/canvas.schema";
import { selectRelevantFiles } from "../../src/collector/documents";

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

  test("does not select files that are neither referenced nor recognisable (SRC-006)", () => {
    const files = [file(1, "meme.jpg")];
    const selected = selectRelevantFiles(files, ["totally unrelated announcement text"]);
    expect(selected).toEqual([]);
  });
});
