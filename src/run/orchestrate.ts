import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { BunContext } from "@effect/platform-bun";
import { Effect } from "effect";
import type { CourseInterpretationInput } from "../ai/input";
import { candidateToFact } from "../ai/reduce";
import type { CandidateEnvelope } from "../ai/types";
import type { FailureAlert } from "../alerts/resend";
import type { CollectionResult } from "../collector/run";
import type { CourseCode } from "../config/courses";
import type { UserStatus } from "../domain/task";
import { healthSummary } from "../health/summary";
import type { NormalizedRecord } from "../normalize/types";
import type { NotionClient } from "../notion/client";
import { bundleContiguousLectures } from "../projector/bundle";
import { factsFromRecords } from "../projector/from-records";
import { planReconciliation } from "../reconcile/plan";
import { projectTask } from "../rules/lifecycle";
import { writeJsonAtomic } from "../state/atomic";
import { writeBaseline } from "../state/baseline-store";

const PROSE_KINDS = new Set(["assignment", "quiz", "announcement", "module", "page"]);
const TERMINAL = new Set<UserStatus>(["Done", "Dropped"]);

export interface SyncDependencies {
  collect: () => Promise<CollectionResult>;
  notion: Pick<NotionClient, "listExistingActions" | "applyAndVerify" | "updateHealthBlock">;
  interpret: (input: CourseInterpretationInput) => Promise<CandidateEnvelope>;
  alert: { send(alert: FailureAlert): Promise<void> };
  healthBlockId: string;
  dashboardUrl: string;
  dataDir: string;
  now?: Date;
}

export async function runSync(deps: SyncDependencies) {
  const now = deps.now ?? new Date();
  const collection = await deps.collect();
  let existing: Awaited<ReturnType<typeof deps.notion.listExistingActions>> = [];
  let notionListError: unknown;
  try {
    existing = await deps.notion.listExistingActions();
  } catch (error) {
    notionListError = error;
  }
  const contextDocument = await readFile(join(process.cwd(), "docs/context.md"), "utf8").catch(
    () => "",
  );
  const failures: Array<{ course: string; stage: string; detail: string }> = [];
  const lastSuccessful = new Map<CourseCode, string>();
  await Promise.all(
    collection.manifest.courses.map(async (entry) => {
      lastSuccessful.set(entry.courseCode, await lastSuccessfulAt(deps.dataDir, entry.courseCode));
    }),
  );

  for (const entry of collection.manifest.courses) {
    const records = collection.records[entry.courseCode] ?? [];
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
      continue;
    }
    try {
      if (notionListError) throw notionListError;
      const facts = factsFromRecords(records).map((fact) => {
        const row = existing.find((candidate) => candidate.automatedIdentity === fact.id);
        const status = row?.properties.Status;
        return typeof status === "string" && TERMINAL.has(status as UserStatus)
          ? { ...fact, userStatus: status as UserStatus }
          : fact;
      });
      const diff = collection.diffs[entry.courseCode];
      const changed = diff ? [...diff.added, ...diff.changed.map((change) => change.after)] : [];
      const input = interpretationInput(entry.courseCode, changed, contextDocument);
      const candidates = await deps.interpret(input);
      facts.push(...candidates.candidates.map(candidateToFact));
      const projected = bundleContiguousLectures(
        facts.map((fact) => projectTask(fact, now)),
      ).filter(
        (task) =>
          !["inactive", "expected"].includes(task.state) ||
          existing.some((row) => row.automatedIdentity === task.id),
      );
      const operations = planReconciliation(existing, projected, now.toISOString());
      for (const operation of operations) await deps.notion.applyAndVerify(operation);
      await Effect.runPromise(
        writeBaseline(deps.dataDir, entry.courseCode, records).pipe(
          Effect.provide(BunContext.layer),
        ),
      );
      entry.stages = {
        ai: input.changedRecords.length || input.referencedDocuments.length ? "success" : "skipped",
        notion: operations.length ? "success" : "skipped",
        baseline: "advanced",
      };
    } catch (error) {
      entry.outcome = "failed";
      const detail = safeError(error);
      entry.stages = { ai: "failed", notion: "failed", baseline: "retained", detail };
      failures.push({
        course: entry.courseCode,
        stage: "pipeline",
        detail: `${detail}; last successful sync: ${lastSuccessful.get(entry.courseCode)}`,
      });
    }
  }

  collection.manifest.finishedAt = new Date().toISOString();
  const health = healthSummary(
    collection.manifest.courses.map((entry) => ({
      courseCode: entry.courseCode,
      outcome: entry.outcome,
      finishedAt: collection.manifest.finishedAt,
    })),
  );
  try {
    await deps.notion.updateHealthBlock(deps.healthBlockId, health);
  } catch (error) {
    failures.push({ course: "SYSTEM", stage: "health", detail: safeError(error) });
  }

  let alertFailed = false;
  const alertSummary =
    failures.length > 0 && !health.startsWith("LAST SYNC FAILED")
      ? `LAST SYNC FAILED — ${health}`
      : health;
  if (failures.length) {
    try {
      await deps.alert.send({
        runId: collection.runId,
        runTime: collection.manifest.finishedAt,
        summary: alertSummary,
        failures,
        dashboardUrl: deps.dashboardUrl,
      });
      collection.manifest.alert = { status: "success" };
    } catch (error) {
      alertFailed = true;
      collection.manifest.alert = { status: "failed", detail: safeError(error) };
    }
  } else {
    collection.manifest.alert = { status: "skipped" };
  }
  await Effect.runPromise(
    writeJsonAtomic(join(collection.snapshotDir, "manifest.json"), collection.manifest).pipe(
      Effect.provide(BunContext.layer),
    ),
  );
  return {
    ok: failures.length === 0 && !alertFailed,
    health: alertSummary,
    failures,
    alertFailed,
    collection,
  };
}

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
  return document.slice(start, end < 0 ? undefined : end);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/([?&](?:access_token|token|verifier|key)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted]")
    .slice(0, 500);
}

async function lastSuccessfulAt(dataDir: string, courseCode: CourseCode) {
  try {
    return (await stat(join(dataDir, "baselines", `${courseCode}.json`))).mtime.toISOString();
  } catch {
    return "never";
  }
}
