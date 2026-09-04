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

const STDERR_DETAIL_LIMIT = 2000;

// argv is logged/inherited by the OS; the prompt travels over stdin instead so
// it never appears there (and so it can't blow past the OS argv/env size limit).
export function buildCodexArgs(
  schemaPath: string,
  outputPath: string,
  workingDirectory: string,
): Array<string> {
  return [
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
    "-",
  ];
}

// Strips values that would let anyone who reads a crash report replay the caller's
// credentials, then bounds the remainder so a runaway CLI can't flood logs/errors.
export function sanitizeStderr(text: string, maxLength = STDERR_DETAIL_LIMIT): string {
  const redacted = text
    .replace(/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/([?&][\w.-]*(?:token|key|verifier)[\w.-]*=)[^&\s]+/gi, "$1[REDACTED]");
  const trimmed = redacted.trim();
  return trimmed.length > maxLength ? `[truncated] ...${trimmed.slice(-maxLength)}` : trimmed;
}

export class CodexCliExecutor implements CodexExecutor {
  async execute(prompt: string, schemaPath: string, outputPath: string, workingDirectory: string) {
    const env = Object.fromEntries(
      ["PATH", "CODEX_HOME", "HOME", "LANG", "LC_ALL", "SSL_CERT_FILE"].flatMap((key) =>
        process.env[key] ? [[key, process.env[key]!]] : [],
      ),
    );
    const processResult = Bun.spawn(buildCodexArgs(schemaPath, outputPath, workingDirectory), {
      cwd: workingDirectory,
      env,
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    });

    const writeStdin = (async () => {
      processResult.stdin.write(prompt);
      await processResult.stdin.end();
    })();

    const stderrChunks: Array<string> = [];
    const drainStderr = (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of processResult.stderr as AsyncIterable<Uint8Array>) {
        stderrChunks.push(decoder.decode(chunk, { stream: true }));
      }
    })();

    const [exitCode] = await Promise.all([processResult.exited, writeStdin, drainStderr]);
    if (exitCode !== 0) {
      const detail = sanitizeStderr(stderrChunks.join(""));
      throw new Error(`Codex exited with status ${exitCode}${detail ? `: ${detail}` : ""}`);
    }
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
