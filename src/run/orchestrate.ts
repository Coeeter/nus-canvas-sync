import { DateTime, Effect, FileSystem, Option, Path, Result } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import type { CourseInterpretationInput } from "../ai/input";
import { mergeCandidateEnvelopes } from "../ai/state";
import type { CandidateEnvelope } from "../ai/types";
import type { FailureAlert } from "../alerts/resend";
import type { CollectionResult } from "../collector/run";
import type { CourseCode } from "../config/courses";
import { TaskAffectingFailureError } from "../errors";
import { healthSummary } from "../health/summary";
import type { NormalizedRecord } from "../normalize/types";
import { factsFromRecords } from "../projector/from-records";
import type { ExistingAction, ReconcileOperation } from "../reconcile/plan";
import { stateAfterVerifiedWrites } from "../reconcile/state";
import { writeJsonAtomic } from "../state/atomic";
import { writeBaseline } from "../state/baseline-store";
import { readInterpretation, writeInterpretation } from "../state/interpretation-store";
import { readReconciliationState, writeReconciliationState } from "../state/reconcile-store";
import { planCourse } from "./course-plan";

const PROSE_KINDS = new Set(["assignment", "quiz", "announcement", "module", "page"]);

interface NotionSyncClient {
  listExistingActions(): Effect.Effect<ReadonlyArray<ExistingAction>, unknown>;
  applyAndVerify(operation: ReconcileOperation): Effect.Effect<ExistingAction, unknown>;
  syncPlannerViews(now: Date): Effect.Effect<void, unknown>;
  updateHealthBlock(blockId: string, message: string): Effect.Effect<void, unknown>;
}

interface AlertClient {
  send(alert: FailureAlert): Effect.Effect<void, unknown>;
}

export interface SyncDependencies {
  readonly collect: Effect.Effect<CollectionResult, unknown>;
  readonly notion: NotionSyncClient;
  readonly interpret: (
    input: CourseInterpretationInput,
  ) => Effect.Effect<
    CandidateEnvelope,
    unknown,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >;
  readonly alert: AlertClient;
  readonly healthBlockId: string;
  readonly dashboardUrl: string;
  readonly dataDir: string;
  readonly now?: DateTime.Utc;
}

export const runSync = Effect.fn("runSync")(function* (deps: SyncDependencies) {
  const path = yield* Path.Path;
  const now = deps.now ?? (yield* DateTime.now);
  const nowIso = DateTime.formatIso(now);
  const nowDate = DateTime.toDateUtc(now);

  yield* logEvent("collection_started", { startedAt: nowIso });
  const collection = yield* deps.collect.pipe(
    Effect.tap((result) =>
      logEvent("collection_finished", {
        runId: result.runId,
        courses: result.manifest.courses.map((entry) => ({
          course: entry.courseCode,
          outcome: entry.outcome,
        })),
      }),
    ),
    Effect.withSpan("nus-sync.collection"),
  );

  yield* logEvent("notion_read_started", { runId: collection.runId });
  const notionRead = yield* deps.notion.listExistingActions().pipe(
    Effect.tap((actions) =>
      logEvent("notion_read_finished", { runId: collection.runId, actions: actions.length }),
    ),
    Effect.result,
    Effect.withSpan("nus-sync.notion.read"),
  );
  if (Result.isFailure(notionRead)) {
    yield* logEvent("notion_read_failed", {
      runId: collection.runId,
      detail: safeError(notionRead.failure),
    });
  }
  const existing: ReadonlyArray<ExistingAction> = Result.isSuccess(notionRead)
    ? notionRead.success
    : [];
  const contextDocument = yield* readContextDocument();
  const failures: Array<{ course: string; stage: string; detail: string }> = [];
  const lastSuccessfulEntries = yield* Effect.forEach(
    collection.manifest.courses,
    (entry) =>
      lastSuccessfulAt(deps.dataDir, entry.courseCode).pipe(
        Effect.map((lastSuccessful) => [entry.courseCode, lastSuccessful] as const),
      ),
    { concurrency: "unbounded" },
  );
  const lastSuccessful = new Map<CourseCode, string>(lastSuccessfulEntries);

  for (const entry of collection.manifest.courses) {
    const records = collection.records[entry.courseCode] ?? [];
    yield* logEvent("course_started", {
      runId: collection.runId,
      course: entry.courseCode,
      records: records.length,
    });

    if (entry.outcome === "failed") {
      entry.stages = {
        ai: "skipped",
        notion: "skipped",
        baseline: "retained",
        detail: "collection coverage failed",
      };
      failures.push({
        course: entry.courseCode,
        stage: "collection",
        detail: `required source coverage failed; last successful sync: ${lastSuccessful.get(entry.courseCode)}`,
      });
      yield* logEvent("course_failed", {
        runId: collection.runId,
        course: entry.courseCode,
        stage: "collection",
        detail: "required source coverage failed",
      });
      continue;
    }

    const courseResult = yield* Effect.gen(function* () {
      if (Result.isFailure(notionRead)) return yield* Effect.fail(notionRead.failure);

      const diff = collection.diffs[entry.courseCode];
      const previousCandidates = yield* readInterpretation(deps.dataDir, entry.courseCode);
      const reconciliationState = yield* readReconciliationState(deps.dataDir, entry.courseCode);
      const changed =
        previousCandidates === null
          ? records
          : diff
            ? [...diff.added, ...diff.changed.map((change) => change.after)]
            : [];
      const deterministicFacts = factsFromRecords(records);
      const input = interpretationInput(
        entry.courseCode,
        changed,
        contextDocument,
        records,
        deterministicFacts,
        reconciliationState,
      );

      yield* logEvent("course_ai_started", {
        runId: collection.runId,
        course: entry.courseCode,
        changedRecords: input.changedRecords.length,
        referencedDocuments: input.referencedDocuments.length,
      });
      const freshCandidates = yield* deps.interpret(input).pipe(
        Effect.tap((result) =>
          logEvent("course_ai_finished", {
            runId: collection.runId,
            course: entry.courseCode,
            candidates: result.candidates.length,
          }),
        ),
        Effect.withSpan("nus-sync.course.ai"),
      );
      const affectedSourceIds = new Set([
        ...changed.map((record) => record.id),
        ...(diff?.removed.map((record) => record.id) ?? []),
      ]);
      const candidates =
        previousCandidates === null
          ? freshCandidates
          : mergeCandidateEnvelopes(previousCandidates, freshCandidates, affectedSourceIds);
      const plan = planCourse({
        records,
        candidates,
        existing,
        reconciliationState,
        now: nowDate,
        syncedAt: nowIso,
      });
      if (plan.conflicts.length > 0) {
        return yield* new TaskAffectingFailureError({
          command: "plan reconciliation",
          message: plan.conflicts
            .map(
              (conflict) =>
                `${conflict.title} (${conflict.identity}): ${conflict.reason}; sources=${conflict.sourceIds.join(",")}`,
            )
            .join(" | "),
        });
      }
      const operations = plan.operations;
      yield* logEvent("course_notion_started", {
        runId: collection.runId,
        course: entry.courseCode,
        operations: operations.length,
      });
      const verified = yield* Effect.forEach(operations, (operation) =>
        deps.notion.applyAndVerify(operation),
      ).pipe(Effect.withSpan("nus-sync.course.notion"));
      const verifiedExisting = [...existing];
      for (const row of verified) {
        const index = verifiedExisting.findIndex((candidate) => candidate.id === row.id);
        if (index >= 0) verifiedExisting[index] = row;
        else verifiedExisting.push(row);
      }
      yield* writeReconciliationState(
        deps.dataDir,
        entry.courseCode,
        stateAfterVerifiedWrites(
          reconciliationState,
          verifiedExisting,
          plan.projections,
          operations,
        ),
      );
      yield* writeInterpretation(deps.dataDir, entry.courseCode, candidates);
      yield* writeBaseline(deps.dataDir, entry.courseCode, records).pipe(
        Effect.withSpan("nus-sync.course.baseline"),
      );

      entry.stages = {
        ai: input.changedRecords.length || input.referencedDocuments.length ? "success" : "skipped",
        notion: operations.length ? "success" : "skipped",
        baseline: "advanced",
      };
      yield* logEvent("course_finished", {
        runId: collection.runId,
        course: entry.courseCode,
        operations: operations.length,
      });
    }).pipe(
      Effect.annotateLogs({ runId: collection.runId, course: entry.courseCode }),
      Effect.withSpan("nus-sync.course", {
        attributes: { runId: collection.runId, course: entry.courseCode },
      }),
      Effect.result,
    );

    if (Result.isFailure(courseResult)) {
      entry.outcome = "failed";
      const detail = safeError(courseResult.failure);
      entry.stages = { ai: "failed", notion: "failed", baseline: "retained", detail };
      failures.push({
        course: entry.courseCode,
        stage: "pipeline",
        detail: `${detail}; last successful sync: ${lastSuccessful.get(entry.courseCode)}`,
      });
      yield* logEvent("course_failed", {
        runId: collection.runId,
        course: entry.courseCode,
        stage: "pipeline",
        detail,
      });
    }
  }

  const views = yield* deps.notion.syncPlannerViews(nowDate).pipe(Effect.result);
  if (Result.isFailure(views)) {
    const detail = safeError(views.failure);
    failures.push({ course: "SYSTEM", stage: "views", detail });
    yield* logEvent("views_update_failed", { runId: collection.runId, detail });
  }

  const finishedAt = DateTime.formatIso(yield* DateTime.now);
  collection.manifest.finishedAt = finishedAt;
  const health = healthSummary(
    collection.manifest.courses.map((entry) => ({
      courseCode: entry.courseCode,
      outcome: entry.outcome,
      finishedAt,
    })),
  );

  yield* logEvent("health_update_started", { runId: collection.runId });
  const healthUpdate = yield* deps.notion.updateHealthBlock(deps.healthBlockId, health).pipe(
    Effect.tap(() => logEvent("health_update_finished", { runId: collection.runId })),
    Effect.result,
    Effect.withSpan("nus-sync.health"),
  );
  if (Result.isFailure(healthUpdate)) {
    const detail = safeError(healthUpdate.failure);
    failures.push({ course: "SYSTEM", stage: "health", detail });
    yield* logEvent("health_update_failed", { runId: collection.runId, detail });
  }

  let alertFailed = false;
  const alertSummary =
    failures.length > 0 && !health.startsWith("LAST SYNC FAILED")
      ? `LAST SYNC FAILED — ${health}`
      : health;
  if (failures.length > 0) {
    yield* logEvent("alert_started", { runId: collection.runId, failures: failures.length });
    const alertResult = yield* deps.alert
      .send({
        runId: collection.runId,
        runTime: finishedAt,
        summary: alertSummary,
        failures,
        dashboardUrl: deps.dashboardUrl,
      })
      .pipe(
        Effect.tap(() => logEvent("alert_finished", { runId: collection.runId })),
        Effect.result,
        Effect.withSpan("nus-sync.alert"),
      );
    if (Result.isFailure(alertResult)) {
      alertFailed = true;
      const detail = safeError(alertResult.failure);
      collection.manifest.alert = { status: "failed", detail };
      yield* logEvent("alert_failed", { runId: collection.runId, detail });
    } else {
      collection.manifest.alert = { status: "success" };
    }
  } else {
    collection.manifest.alert = { status: "skipped" };
  }

  yield* writeJsonAtomic(path.join(collection.snapshotDir, "manifest.json"), collection.manifest);
  return {
    ok: failures.length === 0 && !alertFailed,
    health: alertSummary,
    failures,
    alertFailed,
    collection,
  };
});

const readContextDocument = Effect.fn("runSync.readContextDocument")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs.readFileString(path.join(process.cwd(), "docs/context.md")).pipe(
    Effect.catch(() => Effect.succeed("")),
    Effect.withSpan("nus-sync.context.read"),
  );
});

const lastSuccessfulAt = Effect.fn("runSync.lastSuccessfulAt")(function* (
  dataDir: string,
  courseCode: CourseCode,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const info = yield* fs
    .stat(path.join(dataDir, "baselines", `${courseCode}.json`))
    .pipe(Effect.result);
  if (Result.isFailure(info)) return "never";
  return Option.match(info.success.mtime, {
    onNone: () => "never",
    onSome: (mtime) => mtime.toISOString(),
  });
});

const logEvent = Effect.fn("runSync.logEvent")((event: string, fields: Record<string, unknown>) => {
  const log = event.endsWith("_failed") ? Effect.logError(event) : Effect.logInfo(event);
  return log.pipe(Effect.annotateLogs(fields));
});

function interpretationInput(
  courseCode: CourseCode,
  records: ReadonlyArray<NormalizedRecord>,
  contextDocument: string,
  allRecords: ReadonlyArray<NormalizedRecord>,
  deterministicFacts: ReadonlyArray<import("../domain/task").TaskFact>,
  reconciliationState: import("../state/reconcile-store").ReconciliationState,
) {
  const referencedDocuments = records.filter((record) => record.kind === "document");
  const changedIds = new Set(records.map((record) => record.id));
  const canonicalTasks = deterministicFacts.map((fact) => ({
    id: fact.id,
    courseCode: fact.courseCode,
    kind: fact.kind,
    title: fact.title,
    sourceIds: fact.sourceIds,
    ...(fact.logicalKey ? { logicalKey: fact.logicalKey } : {}),
  }));
  const knownIds = new Set(canonicalTasks.map((task) => task.id));
  for (const task of Object.values(reconciliationState.tasks)) {
    if (!task.kind || !task.title || knownIds.has(task.logicalId)) continue;
    canonicalTasks.push({
      id: task.logicalId,
      courseCode,
      kind: task.kind,
      title: task.title,
      sourceIds: task.sourceIds,
      ...(task.logicalKey ? { logicalKey: task.logicalKey } : {}),
    });
  }
  return {
    courseCode,
    courseContext: courseContext(contextDocument, courseCode),
    changedRecords: records.filter((record) => PROSE_KINDS.has(record.kind)),
    referencedDocuments,
    canonicalTasks,
    unchangedRecords: allRecords
      .filter(
        (record) =>
          !changedIds.has(record.id) && (record.kind === "assignment" || record.kind === "quiz"),
      )
      .map(compactCanonicalRecord),
  } satisfies CourseInterpretationInput;
}

function compactCanonicalRecord(record: NormalizedRecord): NormalizedRecord {
  const fields: Record<string, unknown> = {};
  for (const key of [
    "name",
    "title",
    "dueAt",
    "unlockAt",
    "quizId",
    "published",
    "lockedForUser",
  ]) {
    if (Object.hasOwn(record.fields, key)) fields[key] = record.fields[key];
  }
  return { ...record, fields };
}

function courseContext(document: string, courseCode: CourseCode) {
  const marker = `#### ${courseCode}`;
  const start = document.indexOf(marker);
  if (start < 0) return courseCode;
  const end = document.indexOf("\n#### ", start + marker.length);
  return document.slice(start, end < 0 ? undefined : end);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/([?&](?:access_token|token|verifier|key)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted]")
    .slice(0, 500);
}
