import { Effect, FileSystem, Path, Predicate, Result, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { TaskAffectingFailureError } from "../errors";
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
  ): Effect.Effect<void, unknown, ChildProcessSpawner.ChildProcessSpawner>;
}

export class CodexExecutionError extends Schema.TaggedError<CodexExecutionError>()(
  "CodexExecutionError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

const STDERR_DETAIL_LIMIT = 2000;
const JsonValue = Schema.fromJsonString(Schema.Unknown);

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

export function sanitizeStderr(text: string, maxLength = STDERR_DETAIL_LIMIT): string {
  const redacted = text
    .replace(/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/([?&][\w.-]*(?:token|key|verifier)[\w.-]*=)[^&\s]+/gi, "$1[REDACTED]");
  const trimmed = redacted.trim();
  return trimmed.length > maxLength ? `[truncated] ...${trimmed.slice(-maxLength)}` : trimmed;
}

export class CodexCliExecutor implements CodexExecutor {
  execute(prompt: string, schemaPath: string, outputPath: string, workingDirectory: string) {
    return executeCodex(prompt, schemaPath, outputPath, workingDirectory).pipe(Effect.scoped);
  }
}

const executeCodex = Effect.fn("CodexCliExecutor.execute")(function* (
  prompt: string,
  schemaPath: string,
  outputPath: string,
  workingDirectory: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const env = Object.fromEntries(
    ["PATH", "CODEX_HOME", "HOME", "LANG", "LC_ALL", "SSL_CERT_FILE"].flatMap((key) => {
      const value = process.env[key];
      return Predicate.isString(value) ? [[key, value] as const] : [];
    }),
  );
  const args = buildCodexArgs(schemaPath, outputPath, workingDirectory);
  const command = ChildProcess.make(args[0] ?? "codex", args.slice(1), {
    cwd: workingDirectory,
    env,
    stdin: Stream.fromIterable([new TextEncoder().encode(prompt)]),
    stdout: "ignore",
    stderr: "pipe",
  });
  const handle = yield* spawner
    .spawn(command)
    .pipe(
      Effect.mapError(
        (cause) => new CodexExecutionError({ message: "Failed to start Codex", cause }),
      ),
    );
  const [exitCode, stderr] = yield* Effect.all(
    [handle.exitCode, handle.stderr.pipe(Stream.decodeText(), Stream.mkString)] as const,
    { concurrency: "unbounded" },
  ).pipe(
    Effect.mapError((cause) => new CodexExecutionError({ message: "Codex process failed", cause })),
  );
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    const detail = sanitizeStderr(stderr);
    return yield* new CodexExecutionError({
      message: `Codex exited with status ${exitCode}${detail ? `: ${detail}` : ""}`,
      cause: exitCode,
    });
  }
});

export const interpretCourse = Effect.fn("interpretCourse")(function* (
  input: CourseInterpretationInput,
  instructions: string,
  schema: string,
  executor: CodexExecutor,
) {
  if (input.changedRecords.length === 0 && input.referencedDocuments.length === 0) {
    return { candidates: [] } satisfies CandidateEnvelope;
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "nus-sync-codex-" });
  const schemaPath = path.join(directory, "schema.json");
  const outputPath = path.join(directory, "output.json");
  yield* fs.writeFileString(schemaPath, schema, { mode: 0o600 });
  const basePrompt = buildCoursePrompt(input, instructions);
  const allowed = new Set(
    [...input.changedRecords, ...input.referencedDocuments].map((record) => record.id),
  );

  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = feedback
      ? `${basePrompt}\n\nYour previous output was rejected: ${feedback}. Return a corrected complete output. Do not repeat unsupported or non-verbatim evidence.`
      : basePrompt;
    const result = yield* Effect.gen(function* () {
      yield* executor
        .execute(prompt, schemaPath, outputPath, directory)
        .pipe(Effect.timeout("5 minutes"));
      const encoded = yield* fs.readFileString(outputPath);
      const raw = yield* Schema.decodeUnknownEffect(JsonValue)(encoded);
      return yield* Effect.try({
        try: () =>
          validateCandidates(raw, input.courseCode, allowed, [
            ...input.changedRecords,
            ...input.referencedDocuments,
          ]),
        catch: (cause) => cause,
      });
    }).pipe(Effect.result);
    if (Result.isSuccess(result)) return result.success;
    if (attempt === 1) return yield* Effect.fail(result.failure);
    feedback =
      result.failure instanceof TaskAffectingFailureError
        ? result.failure.message
        : "the output could not be decoded or validated";
  }
  return yield* Effect.die("unreachable interpretation retry state");
}, Effect.scoped);
