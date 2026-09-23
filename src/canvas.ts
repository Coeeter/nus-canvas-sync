import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SemesterConfig } from "./types";

const QUERIES = [
  ["assignments", "list", "--include", "submission,rubric"],
  ["quizzes", "list"],
  ["announcements", "list"],
  ["modules", "list", "--include", "items,content_details"],
  ["pages", "list", "--include", "body"],
  ["files", "list"],
] as const;

export async function collectCanvas(
  semester: SemesterConfig,
  dataDir: string,
  runId: string,
): Promise<string> {
  const root = join(dataDir, "canvas", safeName(semester.term));
  const temporary = join(root, `.collect-${runId}`);
  const latest = join(root, "latest");
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  try {
    for (const course of semester.courses) {
      const courseDir = join(temporary, course.code);
      let successfulQueries = 0;
      const collected = new Map<string, unknown>();
      await mkdir(join(courseDir, "files"), { recursive: true });
      for (const query of QUERIES) {
        const [resource, operation, ...extra] = query;
        try {
          const value = await canvasJson([
            resource,
            operation,
            "--course-id",
            String(course.canvasId),
            ...extra,
          ]);
          successfulQueries++;
          collected.set(resource, value);
          await Bun.write(join(courseDir, `${resource}.json`), JSON.stringify(value, null, 2));
        } catch (error) {
          await Bun.write(
            join(courseDir, `${resource}.error.json`),
            JSON.stringify(
              { resource, error: redact(error instanceof Error ? error.message : String(error)) },
              null,
              2,
            ),
          );
        }
      }
      const references = moduleReferences(collected.get("modules"));
      if (!collected.has("pages")) {
        const pages: Array<unknown> = [];
        const errors: Array<{ pageUrl: string; error: string }> = [];
        for (const pageUrl of references.pageUrls) {
          try {
            pages.push(
              await canvasJson(["pages", "get", "--course-id", String(course.canvasId), pageUrl]),
            );
          } catch (error) {
            errors.push({ pageUrl, error: redact(String(error)) });
          }
        }
        await Bun.write(join(courseDir, "module-pages.json"), JSON.stringify(pages, null, 2));
        await Bun.write(
          join(courseDir, "module-page-errors.json"),
          JSON.stringify(errors, null, 2),
        );
      }
      const listedFiles = Array.isArray(collected.get("files"))
        ? (collected.get("files") as Array<unknown>)
        : [];
      const filesById = new Map<string, unknown>();
      for (const file of listedFiles) {
        if (file && typeof file === "object" && "id" in file) filesById.set(String(file.id), file);
      }
      const moduleFileErrors: Array<{ id: number; error: string }> = [];
      for (const id of references.fileIds) {
        if (filesById.has(String(id))) continue;
        try {
          filesById.set(String(id), await canvasJson(["files", "get", String(id)]));
        } catch (error) {
          moduleFileErrors.push({ id, error: redact(String(error)) });
        }
      }
      const fileMetadata = [...filesById.values()];
      await Bun.write(join(courseDir, "file-metadata.json"), JSON.stringify(fileMetadata, null, 2));
      await Bun.write(
        join(courseDir, "module-file-errors.json"),
        JSON.stringify(moduleFileErrors, null, 2),
      );
      const { errors, selection } = await downloadFiles(
        fileMetadata,
        join(courseDir, "files"),
        join(latest, course.code),
      );
      await Bun.write(
        join(courseDir, "file-download-errors.json"),
        JSON.stringify(errors, null, 2),
      );
      await Bun.write(
        join(courseDir, "file-download-selection.json"),
        JSON.stringify(selection, null, 2),
      );
      if (successfulQueries === 0)
        throw new Error(`Canvas collection failed for every endpoint in ${course.code}`);
    }
    const old = `${latest}.old`;
    await rm(old, { recursive: true, force: true });
    try {
      await rename(latest, old);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(temporary, latest);
    await rm(old, { recursive: true, force: true });
    return latest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function moduleReferences(value: unknown): {
  pageUrls: Array<string>;
  fileIds: Array<number>;
} {
  const pageUrls = new Set<string>();
  const fileIds = new Set<number>();
  if (!Array.isArray(value)) return { pageUrls: [], fileIds: [] };
  for (const module of value) {
    if (!module || typeof module !== "object" || module.state === "locked") continue;
    if (!Array.isArray(module.items)) continue;
    for (const item of module.items) {
      if (!item || typeof item !== "object" || item.locked_for_user === true) continue;
      if (item.type === "Page" && typeof item.page_url === "string") pageUrls.add(item.page_url);
      if (item.type === "File" && Number.isInteger(item.content_id)) fileIds.add(item.content_id);
    }
  }
  return { pageUrls: [...pageUrls], fileIds: [...fileIds] };
}

async function downloadFiles(
  value: unknown,
  destination: string,
  previousCourseDir: string,
): Promise<{
  errors: Array<{ id: string; name: string; error: string }>;
  selection: Array<{ id: string; name: string; action: "downloaded" | "reused" | "skipped" }>;
}> {
  const errors: Array<{ id: string; name: string; error: string }> = [];
  const selection: Array<{
    id: string;
    name: string;
    action: "downloaded" | "reused" | "skipped";
  }> = [];
  const previousFiles = await Bun.file(join(previousCourseDir, "file-metadata.json"))
    .json()
    .catch(async () =>
      Bun.file(join(previousCourseDir, "files.json"))
        .json()
        .catch(() => []),
    );
  const previousById = new Map(
    (Array.isArray(previousFiles) ? previousFiles : [])
      .filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
      .map((file) => [String(file.id), file]),
  );
  if (!Array.isArray(value)) return { errors, selection };
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (
      (typeof row.id !== "number" && typeof row.id !== "string") ||
      typeof row.display_name !== "string"
    )
      continue;
    const id = String(row.id);
    const name = row.display_name;
    if (!shouldDownloadFile(name, row.size) || row.locked_for_user === true) {
      selection.push({ id, name, action: "skipped" });
      continue;
    }
    const output = join(destination, `${id}-${safeName(basename(name))}`);
    await mkdir(dirname(output), { recursive: true });
    try {
      const previous = previousById.get(id);
      const cached = join(previousCourseDir, "files", basename(output));
      if (
        previous?.size === row.size &&
        previous?.updated_at === row.updated_at &&
        (await Bun.file(cached).exists())
      ) {
        await copyFile(cached, output);
        if (await Bun.file(`${cached}.txt`).exists())
          await copyFile(`${cached}.txt`, `${output}.txt`);
        else if (/\.pdf$/i.test(output)) await extractPdf(output);
        selection.push({ id, name, action: "reused" });
      } else {
        await runCanvas(["files", "download", id, "--destination", output]);
        if (/\.pdf$/i.test(output)) await extractPdf(output);
        selection.push({ id, name, action: "downloaded" });
      }
    } catch (error) {
      errors.push({
        id: String(row.id),
        name: row.display_name,
        error: redact(error instanceof Error ? error.message : String(error)),
      });
    }
  }
  return { errors, selection };
}

export function shouldDownloadFile(name: string, size: unknown): boolean {
  if (!/\.(pdf|docx?|txt)$/i.test(name)) return false;
  // Large files are usually teaching/reference media; the agent can fetch one on demand.
  if (typeof size === "number" && size > 20_000_000) return false;
  return /syllabus|course[-_ ]?(admin|outline|plan|guide|schedule)|project|assignment|assessment|exam|quiz|tutorial|midterm|proposal|report|presentation|guidance|brief|rubric|submission|practice|problem[-_ ]?set|^ps[-_ ]?\d|^mid\.pdf$|sop/i.test(
    name,
  );
}

async function extractPdf(path: string): Promise<void> {
  const process = Bun.spawn(["pdftotext", "-layout", path, `${path}.txt`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await process.exited) !== 0) throw new Error(`Failed to extract PDF: ${path}`);
}

async function canvasJson(args: Array<string>): Promise<unknown> {
  const output = await runCanvas([...args, "--no-cache", "--quiet", "--output", "json"]);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Canvas returned invalid JSON for: canvas ${args.join(" ")}`);
  }
}

async function runCanvas(args: Array<string>, attempts = 3): Promise<string> {
  let last = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const process = Bun.spawn(["canvas", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: processEnv(),
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode === 0) return stdout;
    last = stderr.trim();
    if (attempt < attempts) await Bun.sleep(250 * 2 ** (attempt - 1));
  }
  throw new Error(`Canvas command failed: canvas ${args.join(" ")}: ${redact(last)}`);
}

function processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function redact(value: string): string {
  return value
    .replace(/(token|authorization|bearer)(\s*[:=]?\s*)\S+/gi, "$1$2[REDACTED]")
    .slice(-2000);
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
