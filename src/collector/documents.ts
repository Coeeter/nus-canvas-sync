import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import type { CanvasFile } from "../../schemas/canvas.schema";
import { TaskAffectingFailureError, type TransientFailureError } from "../errors";
import { sanitizeSourceText } from "../normalize/sanitize";
import type { NormalizedRecord } from "../normalize/types";
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

/** Canvas can list a future/locked file with a blank `url` (no download available yet); such a file is not fetchable. */
export function hasDownloadableUrl(file: CanvasFile): boolean {
  return file.url.trim().length > 0;
}

export function referencedByForFile(
  file: CanvasFile,
  records: ReadonlyArray<NormalizedRecord>,
): Array<string> {
  return records
    .filter((record) => {
      const value = JSON.stringify(record.fields);
      return value.includes(`/files/${file.id}`) || value.includes(sanitizeSourceText(file.url));
    })
    .map((record) => record.id)
    .sort();
}

/** Downloads one selected file and extracts text when the format is supported (plain text now; PDF via `pdftotext` when present). */
export const downloadAndExtract = Effect.fn("downloadAndExtract")(function* (
  file: CanvasFile,
  destDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;

  const bytes = yield* HttpClient.get(file.url).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.arrayBuffer),
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.mapError(
      (error) =>
        new TaskAffectingFailureError({
          command: `download ${file.url}`,
          message: error.message,
        }),
    ),
    Effect.provide(FetchHttpClient.layer),
  );

  yield* Effect.mapError(fs.makeDirectory(destDir, { recursive: true }), toDocumentError(file));
  const safeName = file.display_name.replace(/[\\/]/g, "_");
  const destPath = pathService.join(destDir, `${file.id}-${safeName}`);
  yield* Effect.mapError(fs.writeFile(destPath, bytes), toDocumentError(file));

  return yield* Effect.ensuring(
    Effect.map(
      Effect.mapError(extractText(destPath, file.display_name), toDocumentError(file)),
      (text) => ({ text }),
    ),
    Effect.ignore(fs.remove(destPath, { force: true })),
  );
});

const toDocumentError =
  (file: CanvasFile) =>
  (error: PlatformError | TaskAffectingFailureError | TransientFailureError) => {
    if (error._tag === "TaskAffectingFailureError") return error;
    if (error._tag === "TransientFailureError") return error;
    return new TaskAffectingFailureError({
      command: `extract document ${file.id}`,
      message: error.message,
    });
  };

const extractText = Effect.fn("extractText")(function* (path: string, displayName: string) {
  if (/\.(txt|md)$/i.test(displayName)) {
    const fs = yield* FileSystem.FileSystem;
    return yield* Effect.orElseSucceed(fs.readFileString(path), () => null);
  }
  if (/\.pdf$/i.test(displayName)) {
    const result = yield* runProcess("pdftotext", [path, "-"], {
      PATH: process.env.PATH ?? "",
    });
    if (result.exitCode !== 0) {
      return yield* Effect.fail(
        new TaskAffectingFailureError({
          command: "pdftotext",
          message: result.stderr.slice(0, 500),
        }),
      );
    }
    return result.stdout;
  }
  return yield* Effect.fail(
    new TaskAffectingFailureError({
      command: "extract document",
      message: `unsupported document format: ${displayName}`,
    }),
  );
});
