import { Effect, ParseResult, Schema } from "effect";
import {
  acceptedAlternates,
  acceptsGapFailure,
  COURSE_CAPABILITIES,
  type CourseCapabilities,
  type CourseCode,
  type CourseEndpoint,
  isRequiredEndpoint,
} from "../config/courses";
import { CapabilityGapError, TaskAffectingFailureError, TransientFailureError } from "../errors";
import type { ProcessResult } from "./process";

export type FailureClass = "auth" | "not-found" | "transient" | "unknown";

/** Classifies a failed process's stderr so the caller can pick a capability-gap, retry, or hard-failure outcome. */
export function classifyFailure(stderr: string): FailureClass {
  const text = stderr.toLowerCase();
  if (/\b(401|403)\b|\b(?:un|not\s+)authori[sz]|forbidden|authentication/.test(text)) {
    return "auth";
  }
  if (/\b404\b|not found/.test(text)) return "not-found";
  if (/\b(429|502|503|504)\b|timeout|timed out|econnreset|econnrefused|rate limit/.test(text)) {
    return "transient";
  }
  return "unknown";
}

/** Strips anything shaped like a bearer token or URL query secret before it reaches logs/manifests. */
function sanitize(text: string) {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:token|verifier|key)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 2000);
}

function decodeJson<A, I>(command: string, result: ProcessResult, schema: Schema.Schema<A, I>) {
  return Effect.gen(function* () {
    const json = yield* Effect.try({
      try: () => JSON.parse(result.stdout) as unknown,
      catch: (error) =>
        new TaskAffectingFailureError({ command, message: `invalid JSON: ${String(error)}` }),
    });
    return yield* Schema.decodeUnknown(schema)(json).pipe(
      Effect.mapError(
        (error) =>
          new TaskAffectingFailureError({
            command,
            message: `schema validation failed: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
          }),
      ),
    );
  });
}

/**
 * Turns a raw process result for one course endpoint into data or a failure
 * in the error channel. A declared, alternate-covered gap that fails with
 * `not-found` becomes `CapabilityGapError` rather than a hard failure
 * (SRC-005); other failures are `TransientFailureError` or
 * `TaskAffectingFailureError` for the caller (Phase 4's orchestrator) to
 * classify for retry/alerting (ERR-001, ERR-002). A response that fails
 * schema validation is task-affecting: Canvas changed shape under us and
 * downstream code must not silently misread it.
 */
export function decodeEndpoint<A, I>(params: {
  course: CourseCode;
  endpoint: CourseEndpoint;
  command: string;
  result: ProcessResult;
  schema: Schema.Schema<A, I>;
  capabilities?: Record<CourseCode, CourseCapabilities>;
}): Effect.Effect<A, CapabilityGapError | TransientFailureError | TaskAffectingFailureError> {
  const { course, endpoint, command, result, schema, capabilities = COURSE_CAPABILITIES } = params;
  if (result.exitCode === 0) return decodeJson(command, result, schema);

  const failureClass = classifyFailure(result.stderr);

  if (
    (failureClass === "not-found" || failureClass === "auth") &&
    !isRequiredEndpoint(course, endpoint, capabilities) &&
    acceptsGapFailure(course, endpoint, failureClass, capabilities)
  ) {
    const alternates = acceptedAlternates(course, endpoint, capabilities);
    return Effect.fail(
      new CapabilityGapError({
        course,
        endpoint,
        reason: `declared ${failureClass} gap; accepted alternates: ${alternates.join(", ")}`,
      }),
    );
  }

  if (failureClass === "transient") {
    return Effect.fail(new TransientFailureError({ command, message: sanitize(result.stderr) }));
  }

  return Effect.fail(new TaskAffectingFailureError({ command, message: sanitize(result.stderr) }));
}

/**
 * For top-level endpoints (planner, GitHub) that have no per-course
 * capability declaration and are always required (SRC-001).
 */
export function decodeRequired<A, I>(params: {
  command: string;
  result: ProcessResult;
  schema: Schema.Schema<A, I>;
}): Effect.Effect<A, TransientFailureError | TaskAffectingFailureError> {
  const { command, result, schema } = params;
  if (result.exitCode === 0) return decodeJson(command, result, schema);
  const failureClass = classifyFailure(result.stderr);
  if (failureClass === "transient") {
    return Effect.fail(new TransientFailureError({ command, message: sanitize(result.stderr) }));
  }
  return Effect.fail(new TaskAffectingFailureError({ command, message: sanitize(result.stderr) }));
}
