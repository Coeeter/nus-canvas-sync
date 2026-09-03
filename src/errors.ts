import { Schema } from "effect";

/**
 * SRC-005: a declared, alternate-covered endpoint gap. Non-fatal — the
 * collector records it in the run manifest and continues.
 */
export class CapabilityGapError extends Schema.TaggedError<CapabilityGapError>()(
  "CapabilityGapError",
  {
    course: Schema.String,
    endpoint: Schema.String,
    reason: Schema.String,
  },
) {}

/** ERR-001: worth a bounded retry at the orchestration layer (Phase 4). */
export class TransientFailureError extends Schema.TaggedError<TransientFailureError>()(
  "TransientFailureError",
  {
    command: Schema.String,
    message: Schema.String,
  },
) {}

/** SRC-004: an undeclared failure or a response that no longer matches its schema. Never silently ignored. */
export class TaskAffectingFailureError extends Schema.TaggedError<TaskAffectingFailureError>()(
  "TaskAffectingFailureError",
  {
    command: Schema.String,
    message: Schema.String,
  },
) {}

/** DIF-005: another run already holds the exclusive lock. */
export class RunLockedError extends Schema.TaggedError<RunLockedError>()("RunLockedError", {
  path: Schema.String,
}) {}
