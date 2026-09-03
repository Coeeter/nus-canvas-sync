import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CourseInterpretationInput } from "./input";
import { buildCoursePrompt } from "./input";
import type { CandidateEnvelope } from "./types";
import { validateCandidates } from "./validate";

export interface CodexExecutor {
  execute(
    prompt: string,
    schemaPath: string,
    outputPath: string,
    workingDirectory: string,
  ): Promise<void>;
}

export class CodexCliExecutor implements CodexExecutor {
  async execute(prompt: string, schemaPath: string, outputPath: string, workingDirectory: string) {
    const env = Object.fromEntries(
      ["PATH", "CODEX_HOME", "HOME", "LANG", "LC_ALL", "SSL_CERT_FILE"].flatMap((key) =>
        process.env[key] ? [[key, process.env[key]!]] : [],
      ),
    );
    const processResult = Bun.spawn(
      [
        "codex",
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--model",
        "gpt-5.6-terra",
        "-c",
        'model_reasoning_effort="medium"',
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "--cd",
        workingDirectory,
        prompt,
      ],
      { cwd: workingDirectory, env, stdout: "ignore", stderr: "ignore" },
    );
    const exitCode = await processResult.exited;
    if (exitCode !== 0) throw new Error(`Codex exited with status ${exitCode}`);
  }
}

export async function interpretCourse(
  input: CourseInterpretationInput,
  instructions: string,
  schema: string,
  executor: CodexExecutor,
): Promise<CandidateEnvelope> {
  if (input.changedRecords.length === 0 && input.referencedDocuments.length === 0) {
    return { candidates: [] };
  }
  const directory = await mkdtemp(join(tmpdir(), "nus-sync-codex-"));
  const schemaPath = join(directory, "schema.json");
  const outputPath = join(directory, "output.json");
  await writeFile(schemaPath, schema, { mode: 0o600 });
  try {
    const prompt = buildCoursePrompt(input, instructions);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await executor.execute(prompt, schemaPath, outputPath, directory);
        const raw = JSON.parse(await readFile(outputPath, "utf8"));
        const allowed = new Set(
          [...input.changedRecords, ...input.referencedDocuments].map((record) => record.id),
        );
        return validateCandidates(raw, input.courseCode, allowed);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
