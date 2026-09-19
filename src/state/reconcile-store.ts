import { Effect, FileSystem, Schema } from "effect";
import type { CourseCode } from "../config/courses";
import type { TaskKind } from "../domain/task";
import { writeJsonAtomic } from "./atomic";
import { reconciliationPath } from "./paths";

export interface ReviewResolution {
  revision: string;
  accepted: boolean;
  overrides: Record<string, unknown>;
}

export interface ReconciliationTaskState {
  logicalId: string;
  kind?: TaskKind;
  title?: string;
  logicalKey?: string | undefined;
  aliases: Array<string>;
  sourceIds: Array<string>;
  /** Values the source reducer proposed on the previous successful run. */
  sourceProposal: Record<string, unknown>;
  /** Values the service actually wrote and verified. */
  lastWritten: Record<string, unknown>;
  /** Existing correction values with no machine-write provenance yet. */
  protectedFields?: Record<string, unknown>;
  review?: ReviewResolution | undefined;
}

export interface ReconciliationState {
  version: 1;
  tasks: Record<string, ReconciliationTaskState>;
}

export class ReconciliationStateError extends Schema.TaggedError<ReconciliationStateError>()(
  "ReconciliationStateError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

const ReviewResolutionSchema = Schema.Struct({
  revision: Schema.String,
  accepted: Schema.Boolean,
  overrides: Schema.Record(Schema.String, Schema.Unknown),
});
const TaskStateSchema = Schema.Struct({
  logicalId: Schema.String,
  kind: Schema.optional(
    Schema.Literals(["assessment", "preparation", "e-lecture", "physical-event", "optional"]),
  ),
  title: Schema.optional(Schema.String),
  logicalKey: Schema.optional(Schema.String),
  aliases: Schema.Array(Schema.String),
  sourceIds: Schema.Array(Schema.String),
  sourceProposal: Schema.Record(Schema.String, Schema.Unknown),
  lastWritten: Schema.Record(Schema.String, Schema.Unknown),
  protectedFields: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  review: Schema.optional(ReviewResolutionSchema),
});
const StateSchema = Schema.Struct({
  version: Schema.Literal(1),
  tasks: Schema.Record(Schema.String, TaskStateSchema),
});

export function emptyReconciliationState(): ReconciliationState {
  return { version: 1, tasks: {} };
}

export const readReconciliationState = Effect.fn("readReconciliationState")(function* (
  dataDir: string,
  courseCode: CourseCode,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = reconciliationPath(dataDir, courseCode);
  if (!(yield* fs.exists(path))) return emptyReconciliationState();
  const raw = yield* fs.readFileString(path);
  // A missing/older file is a safe migration boundary: current Notion rows are
  // still read and their aliases/status are re-established before any write.
  const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(StateSchema))(raw).pipe(
    Effect.mapError(
      (cause) =>
        new ReconciliationStateError({
          message: `Invalid reconciliation state for ${courseCode}`,
          cause,
        }),
    ),
  );
  return {
    version: 1,
    tasks: Object.fromEntries(
      Object.entries(decoded.tasks).map(([id, task]) => [
        id,
        {
          logicalId: task.logicalId,
          ...(task.kind !== undefined ? { kind: task.kind } : {}),
          ...(task.title !== undefined ? { title: task.title } : {}),
          ...(task.logicalKey !== undefined ? { logicalKey: task.logicalKey } : {}),
          aliases: [...task.aliases],
          sourceIds: [...task.sourceIds],
          sourceProposal: { ...task.sourceProposal },
          lastWritten: { ...task.lastWritten },
          ...(task.protectedFields !== undefined
            ? { protectedFields: { ...task.protectedFields } }
            : {}),
          ...(task.review !== undefined
            ? {
                review: {
                  revision: task.review.revision,
                  accepted: task.review.accepted,
                  overrides: { ...task.review.overrides },
                },
              }
            : {}),
        } satisfies ReconciliationTaskState,
      ]),
    ),
  } satisfies ReconciliationState;
});

export const writeReconciliationState = Effect.fn("writeReconciliationState")(function* (
  dataDir: string,
  courseCode: CourseCode,
  state: ReconciliationState,
) {
  yield* writeJsonAtomic(reconciliationPath(dataDir, courseCode), state);
});
