import { Effect, Stream } from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { TaskAffectingFailureError, TransientFailureError } from "../errors";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const TIMEOUT = "60 seconds";

const collectText = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

/**
 * Runs a CLI command and captures its output as data — a nonzero exit code
 * is not an Effect failure here, only a spawn/IO failure or timeout is.
 * Classification into capability-gap/transient/task-affecting happens in
 * `outcome.ts`, against the caller-supplied `env` (never `process.env`
 * directly), keeping credential exposure to subprocesses an explicit,
 * auditable choice per call site (SRC-003, AI-003).
 */
export const runProcess = Effect.fn("runProcess")(function* (
  binary: string,
  args: ReadonlyArray<string>,
  env: Record<string, string>,
) {
  const commandLabel = [binary, ...args].join(" ");
  const command = ChildProcess.make(binary, args).pipe(ChildProcess.setEnv(env));

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const process = yield* command;
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [collectText(process.stdout), collectText(process.stderr), process.exitCode],
        { concurrency: "unbounded" },
      );
      return { stdout, stderr, exitCode: Number(exitCode) };
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: TIMEOUT,
      orElse: () =>
        Effect.fail(
          new TransientFailureError({
            command: commandLabel,
            message: `timed out after ${TIMEOUT}`,
          }),
        ),
    }),
    Effect.catchTag("PlatformError", (error) =>
      Effect.fail(new TaskAffectingFailureError({ command: commandLabel, message: error.message })),
    ),
  );
});
