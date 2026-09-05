import { createHash } from "node:crypto";
import { DateTime, Effect, FileSystem, Option, Path, Result } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { affectedInterpretation } from "../ai/affected";
import type { CourseInterpretationInput } from "../ai/input";
import { mergeCandidateFacts } from "../ai/reduce";
import { mergeCandidateEnvelopes } from "../ai/state";
import type { CandidateEnvelope } from "../ai/types";
import type { FailureAlert } from "../alerts/resend";
import type { CollectionResult } from "../collector/run";
import type { CourseCode } from "../config/courses";
import { healthSummary } from "../health/summary";
import type { NormalizedRecord } from "../normalize/types";
import { bundleContiguousLectures } from "../projector/bundle";
import { applyTaskDependencies } from "../projector/dependencies";
import { factsFromRecords } from "../projector/from-records";
import { applyCourseSchedule } from "../projector/schedule";
import type { ExistingAction, ReconcileOperation } from "../reconcile/plan";
import { findExistingAction, planReconciliation, selectTrackedTasks } from "../reconcile/plan";
import { projectTask } from "../rules/lifecycle";
import { writeJsonAtomic } from "../state/atomic";
import { type CourseState, readCourseState, writeCourseState } from "../state/course-store";
import { mappedActions } from "../state/identity-mappings";
import { readInterpretation } from "../state/interpretation-store";
import { planDates, reconcileMissing, restoreUserDecisions } from "./course-state";

const PROSE_KINDS = new Set(["assignment", "quiz", "announcement", "module", "page"]);

interface NotionSyncClient {
  listExistingActions(
    recoveryPageIds?: ReadonlyArray<string>,
  ): Effect.Effect<ReadonlyArray<ExistingAction>, unknown>;
  applyAndVerify(
    operation: ReconcileOperation,
  ): Effect.Effect<unknown, unknown, FileSystem.FileSystem | Path.Path>;
  syncPlannerViews?(now: Date): Effect.Effect<void, unknown>;
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
  readonly policyVersion?: string;
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

  const states = yield* Effect.forEach(collection.manifest.courses, (entry) =>
    readCourseState(deps.dataDir, entry.courseCode).pipe(Effect.result),
  );
  const recoveryPageIds = states.flatMap((state) =>
    Result.isSuccess(state) && state.success
      ? Object.values(state.success.managed).map((action) => action.pageId)
      : [],
  );
  yield* logEvent("notion_read_started", { runId: collection.runId });
  const notionRead = yield* deps.notion.listExistingActions(recoveryPageIds).pipe(
    Effect.flatMap((actions) => mappedActions(deps.dataDir, actions)),
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

      const previousState = yield* readCourseState(deps.dataDir, entry.courseCode);
      const previousCandidates =
        previousState?.candidates ?? (yield* readInterpretation(deps.dataDir, entry.courseCode));
      const policy = createHash("sha256")
        .update(
          `${deps.policyVersion ?? "audit-fixes-v1"}\n${courseContext(contextDocument, entry.courseCode)}`,
        )
        .digest("hex");
      const { records: changed, affectedSourceIds } = affectedInterpretation(
        previousState?.records ?? [],
        records,
        previousCandidates ?? { candidates: [] },
        !previousState || previousState.policy !== policy,
      );
      const state: CourseState = {
        version: 1,
        runId: collection.runId,
        syncedAt: nowIso,
        policy,
        records,
        candidates: { candidates: [] },
        managed: { ...previousState?.managed },
        resolutions: { ...previousState?.resolutions },
        terminalMembers: { ...previousState?.terminalMembers },
        memberChoices: { ...previousState?.memberChoices },
        reviewFingerprints: { ...previousState?.reviewFingerprints },
      };
      const input = interpretationInput(entry.courseCode, changed, contextDocument);

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
      const candidates =
        previousCandidates === null
          ? freshCandidates
          : mergeCandidateEnvelopes(previousCandidates, freshCandidates, affectedSourceIds);
      state.candidates = candidates;
      const { projected, operations } = yield* Effect.try(() => {
        const facts = applyCourseSchedule(
          applyTaskDependencies(
            restoreUserDecisions(
              mergeCandidateFacts(factsFromRecords(records), candidates.candidates),
              existing,
              records,
              state,
            ),
          ),
        );
        const projected = selectTrackedTasks(
          bundleContiguousLectures(
            facts.map((fact) => projectTask(fact, nowDate)),
            existing,
          ).map((task) => planDates(task, nowDate, records)),
          existing,
        );
        const unclaimed = existing.filter(
          (row) =>
            row.automatedIdentity &&
            row.properties.Course === entry.courseCode &&
            !["Done", "Dropped"].includes(String(row.properties.Status)) &&
            !state.managed[row.automatedIdentity] &&
            !projected.some(
              (task) =>
                findExistingAction(existing, task.id, task.sourceIds, task.title)?.id === row.id,
            ),
        );
        if (unclaimed.length)
          throw new Error(
            `Unmapped active history requires explicit migration before this course can sync: ${unclaimed.map((row) => row.id).join(", ")}`,
          );
        const operations = [
          ...planReconciliation(existing, projected, nowIso),
          ...reconcileMissing(state, projected, records, existing),
        ];
        return { projected, operations };
      });
      yield* logEvent("course_notion_started", {
        runId: collection.runId,
        course: entry.courseCode,
        operations: operations.length,
      });
      for (const operation of operations) {
        const verified = yield* deps.notion.applyAndVerify(operation);
        const projection = projected.find((task) => task.id === operation.identity);
        if (projection) {
          const pageId =
            operation.type === "update"
              ? operation.pageId
              : verified && typeof verified === "object" && "id" in verified
                ? String(verified.id)
                : null;
          if (!pageId)
            return yield* Effect.fail(new Error("Notion write returned no verified page ID"));
          state.managed[projection.id] = {
            pageId,
            sourceIds: [...projection.sourceIds],
            missing: 0,
            lastSeenRun: collection.runId,
          };
        }
      }
      for (const task of projected) {
        if (!state.managed[task.id]) {
          const row = existing.find((action) => action.automatedIdentity === task.id);
          if (row)
            state.managed[task.id] = {
              pageId: row.id,
              sourceIds: task.sourceIds,
              missing: 0,
              lastSeenRun: collection.runId,
            };
        }
        if (state.managed[task.id])
          state.managed[task.id] = {
            ...state.managed[task.id]!,
            sourceIds: [...task.sourceIds],
            missing: 0,
            lastSeenRun: collection.runId,
          };
      }
      yield* writeCourseState(deps.dataDir, entry.courseCode, state);

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

  if (deps.notion.syncPlannerViews) {
    const views = yield* deps.notion.syncPlannerViews(nowDate).pipe(Effect.result);
    if (Result.isFailure(views))
      failures.push({ course: "SYSTEM", stage: "views", detail: safeError(views.failure) });
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
  const healthUpdate = yield* deps.notion
    .updateHealthBlock(
      deps.healthBlockId,
      failures.some((failure) => failure.course === "SYSTEM") &&
        !health.startsWith("LAST SYNC FAILED")
        ? `LAST SYNC FAILED — ${health}; planner view verification failed`
        : health,
    )
    .pipe(
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

  collection.manifest.phase = "completed";
  collection.manifest.ok = failures.length === 0 && !alertFailed;
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
  return yield* fs
    .readFileString(path.join(process.cwd(), "docs/context.md"))
    .pipe(Effect.withSpan("nus-sync.context.read"));
});

const lastSuccessfulAt = Effect.fn("runSync.lastSuccessfulAt")(function* (
  dataDir: string,
  courseCode: CourseCode,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const state = yield* readCourseState(dataDir, courseCode).pipe(Effect.orElseSucceed(() => null));
  if (state) return state.syncedAt;
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
) {
  const referencedDocuments = records.filter((record) => record.kind === "document");
  return {
    courseCode,
    courseContext: courseContext(contextDocument, courseCode),
    changedRecords: records.filter((record) => PROSE_KINDS.has(record.kind)),
    referencedDocuments,
  } satisfies CourseInterpretationInput;
}

function courseContext(document: string, courseCode: CourseCode) {
  const marker = `#### ${courseCode}`;
  const start = document.indexOf(marker);
  if (start < 0) return courseCode;
  const end = document.indexOf("\n#### ", start + marker.length);
  const timetableStart = document.indexOf("### Timetable and semester rhythm");
  const timetableEnd = document.indexOf("### Course model", timetableStart);
  const timetable =
    timetableStart >= 0 && timetableEnd > timetableStart
      ? document.slice(timetableStart, timetableEnd)
      : "";
  return `${timetable}\n${document.slice(start, end < 0 ? undefined : end)}`;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/([?&](?:access_token|token|verifier|key)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted]")
    .slice(0, 500);
}
