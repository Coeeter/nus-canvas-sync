import { mergeCandidateFacts } from "../ai/reduce";
import type { CandidateEnvelope, CanonicalTaskContext } from "../ai/types";
import type { NormalizedRecord } from "../normalize/types";
import { bundleContiguousLectures, terminalLectureMembers } from "../projector/bundle";
import { applyTaskDependencies } from "../projector/dependencies";
import { factsFromRecords } from "../projector/from-records";
import { applyCourseSchedule } from "../projector/schedule";
import type {
  BundleReconciliationConflict,
  ExistingAction,
  ReconcileOperation,
} from "../reconcile/plan";
import {
  allowSourceAliases,
  bundleReconciliationConflict,
  findExistingAction,
  planReconciliation,
  reconciliationProperties,
  selectTrackedTasks,
} from "../reconcile/plan";
import { applyUserState, stateAliases, stateForTask } from "../reconcile/state";
import { projectTask } from "../rules/lifecycle";
import type { ReconciliationState } from "../state/reconcile-store";

export interface CoursePlanInput {
  records: ReadonlyArray<NormalizedRecord>;
  candidates: CandidateEnvelope;
  existing: ReadonlyArray<ExistingAction>;
  reconciliationState: ReconciliationState;
  now: Date;
  syncedAt: string;
}

export interface CoursePlanResult {
  projections: ReadonlyArray<import("../domain/task").TaskProjection>;
  operations: ReadonlyArray<ReconcileOperation>;
  conflicts: ReadonlyArray<BundleReconciliationConflict>;
}

/** Shared deterministic planning boundary used by sync and fixture replay. */
export function planCourse(input: CoursePlanInput): CoursePlanResult {
  const deterministicFacts = factsFromRecords(input.records);
  const canonicalTasks = deterministicFacts.map((fact) => ({
    id: fact.id,
    courseCode: fact.courseCode,
    kind: fact.kind,
    title: fact.title,
    sourceIds: fact.sourceIds,
    ...(fact.logicalKey ? { logicalKey: fact.logicalKey } : {}),
  }));
  const knownTaskIds = new Set(canonicalTasks.map((task) => task.id));
  for (const task of Object.values(input.reconciliationState.tasks)) {
    if (!task.kind || !task.title || knownTaskIds.has(task.logicalId)) continue;
    canonicalTasks.push({
      id: task.logicalId,
      courseCode: input.records[0]?.courseCode ?? "IS1128",
      kind: task.kind,
      title: task.title,
      sourceIds: task.sourceIds,
      ...(task.logicalKey ? { logicalKey: task.logicalKey } : {}),
    });
  }
  const sourcedFacts = applyCourseSchedule(
    mergeCandidateFactsForPlan(deterministicFacts, input.candidates, canonicalTasks),
  );
  const userFacts = sourcedFacts.map((fact) => {
    const stored = stateForTask(input.reconciliationState, fact.id, fact.aliases, fact.logicalKey);
    const row = findExistingAction(
      input.existing,
      fact.id,
      fact.sourceIds,
      fact.title,
      new Set(),
      [...(fact.aliases ?? []), ...stateAliases(stored, fact.logicalKey)],
      allowSourceAliases(input.reconciliationState, fact.logicalKey, fact.sourceIds),
    );
    // Capture the source-backed proposal before user corrections are applied.
    // This is the state boundary that prevents an accepted correction from
    // becoming the next run's supposed source value.
    const sourceProjection = projectTask(fact, input.now);
    return applyUserState(
      {
        ...fact,
        sourceProposal: reconciliationProperties(sourceProjection),
      },
      row,
      stored,
    );
  });
  // Dependencies must see current Notion terminal choices. A completed
  // prerequisite therefore unblocks its successor even when Canvas evidence
  // still says the prerequisite is unfinished. Source proposals were already
  // captured above and are intentionally independent of this lifecycle pass.
  const facts = applyTaskDependencies(userFacts);
  const projected = selectTrackedTasks(
    bundleContiguousLectures(
      facts.map((fact) => projectTask(fact, input.now)),
      terminalLectureMembers(input.existing),
    ),
    input.existing,
  );
  const operations = planReconciliation(
    input.existing,
    projected,
    input.syncedAt,
    input.reconciliationState,
  );
  const conflicts = projected.flatMap((projection) => {
    if (projection.state !== "ready" && projection.state !== "review") return [];
    const conflict = bundleReconciliationConflict(input.existing, projection);
    return conflict ? [conflict] : [];
  });
  return { projections: projected, operations, conflicts };
}

function mergeCandidateFactsForPlan(
  deterministicFacts: ReturnType<typeof factsFromRecords>,
  candidates: CandidateEnvelope,
  canonicalTasks: ReadonlyArray<CanonicalTaskContext>,
) {
  // Kept as a tiny indirection so the orchestration/replay seam has one call
  // site for candidate reduction and cannot drift between production and tests.
  return mergeCandidateFacts(deterministicFacts, candidates.candidates, canonicalTasks);
}
