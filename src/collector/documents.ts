import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";
import type { CanvasFile } from "../../schemas/canvas.schema";
import { TaskAffectingFailureError } from "../errors";
import { runProcess } from "./process";

const RECOGNISABLE_FILENAME = /\b(brief|spec(ification)?|rubric|handout)\b/i;

/**
 * SRC-006: selects only files referenced by changed prose (a Canvas file URL
 * or id appearing in an assignment/announcement/module/page body) or whose
 * filename is a deterministically recognisable brief/spec/rubric — never the
 * full file index.
 */
export function selectRelevantFiles(
  files: ReadonlyArray<CanvasFile>,
  changedProse: ReadonlyArray<string>,
): Array<CanvasFile> {
  return files.filter((file) => {
    if (RECOGNISABLE_FILENAME.test(file.display_name)) return true;
    return changedProse.some(
      (prose) => prose.includes(`/files/${file.id}`) || prose.includes(file.url),
    );
  });
}

/** Downloads one selected file and extracts text when the format is supported (plain text now; PDF via `pdftotext` when present). */
export function downloadAndExtract(file: CanvasFile, destDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    const bytes = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      },
      catch: (error) =>
        new TaskAffectingFailureError({ command: `download ${file.url}`, message: String(error) }),
    });

    yield* fs.makeDirectory(destDir, { recursive: true });
    const destPath = pathService.join(destDir, `${file.id}-${file.display_name}`);
    yield* fs.writeFile(destPath, bytes);

    const text = yield* extractText(destPath, file.display_name);
    return { destPath, text };
  });
}

function extractText(path: string, displayName: string) {
  return Effect.gen(function* () {
    if (/\.(txt|md)$/i.test(displayName)) {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => null));
    }
    if (/\.pdf$/i.test(displayName)) {
      const result = yield* runProcess("pdftotext", [path, "-"], {
        PATH: process.env.PATH ?? "",
      }).pipe(Effect.orElseSucceed(() => null));
      return result && result.exitCode === 0 ? result.stdout : null;
    }
    return null;
  });
}
