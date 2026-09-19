import type { TaskProjection } from "../domain/task";
import type { ReconciliationState, ReconciliationTaskState } from "../state/reconcile-store";
import { sameReconciliationValue } from "./values";

export const AGENT_OWNED_FIELDS = [
  "Canvas Course ID",
  "Canvas Item ID",
  "Canvas Item Type",
  "Parent Canvas ID",
  "Course",
  "Readiness",
  "Needs Review",
  "Available From",
  "Official Due",
  "Source URL",
  "Last Synced",
  "Blocked By",
  "Type",
  "Work Mode",
] as const;

export interface ExistingAction {
  id: string;
  automatedIdentity: string | null;
  properties: Record<string, unknown>;
}

export type ReconcileOperation =
  | { type: "create"; identity: string; properties: Record<string, unknown> }
  | {
      type: "update";
      pageId: string;
      identity: string;
      properties: Record<string, unknown>;
      expectedProperties: Record<string, unknown>;
    };

export function planReconciliation(
  existing: ReadonlyArray<ExistingAction>,
  projections: ReadonlyArray<TaskProjection>,
  syncedAt: string,
  state: ReconciliationState = { version: 1, tasks: {} },
): Array<ReconcileOperation> {
  const claimedPageIds = new Set<string>();
  return projections.flatMap((projection): Array<ReconcileOperation> => {
    const properties = reconciliationProperties(projection);
    const current = findExistingAction(
      existing,
      projection.id,
      projection.sourceIds,
      projection.title,
      claimedPageIds,
      projection.aliases,
      allowSourceAliases(state, projection.logicalKey, projection.sourceIds),
    );
    if (current) claimedPageIds.add(current.id);
    if (!current) {
      if (
        projection.id.startsWith("bundle:") &&
        bundleMatchState(existing, projection.sourceIds, claimedPageIds) === "ambiguous"
      ) {
        // An overlapping split or multiple active bundle is not safe to merge
        // automatically, and creating another row would duplicate work.
        return [];
      }
      if (projection.state !== "ready" && projection.state !== "review") return [];
      return [
        {
          type: "create",
          identity: projection.id,
          properties: {
            ...properties,
            "Last Synced": syncedAt,
            Action: projection.title,
            Status: "Not started",
            ...(projection.needsReview && projection.reason ? { Notes: projection.reason } : {}),
          },
        },
      ];
    }
    const taskState =
      state.tasks[projection.id] ?? findStateByAlias(state, current.automatedIdentity);
    const changed = changedProperties(current.properties, properties, taskState);
    const patch = changed.patch;
    // A user terminal choice is stronger than a newly discovered source
    // disagreement. Keep the conflicting field/history untouched, but never
    // route completed or dropped work back through the review gate.
    if (changed.conflicts.length > 0 && !isTerminalStatus(current.properties.Status)) {
      delete patch["Needs Review"];
      delete patch.Readiness;
      if (!sameReconciliationValue("Needs Review", current.properties["Needs Review"], true))
        patch["Needs Review"] = true;
      if (!sameReconciliationValue("Readiness", current.properties.Readiness, "Review"))
        patch.Readiness = "Review";
    }
    if (Object.keys(patch).length === 0) return [];
    patch["Last Synced"] = syncedAt;
    const expectedProperties = Object.fromEntries(
      Object.keys(patch).map((name) => [name, current.properties[name] ?? null]),
    );
    expectedProperties["Canvas Item ID"] = current.automatedIdentity;
    expectedProperties.Status = current.properties.Status ?? null;
    return [
      {
        type: "update" as const,
        pageId: current.id,
        identity: projection.id,
        properties: patch,
        expectedProperties,
      },
    ];
  });
}

export function findExistingAction(
  existing: ReadonlyArray<ExistingAction>,
  identity: string,
  sourceIds: ReadonlyArray<string>,
  title?: string,
  excludedPageIds: ReadonlySet<string> = new Set(),
  aliases: ReadonlyArray<string> = [],
  useSourceAliases = true,
) {
  const available = existing.filter((row) => !excludedPageIds.has(row.id));
  const exact = available.find((row) => row.automatedIdentity === identity);
  if (exact) return exact;
  if (identity.startsWith("bundle:") && sourceIds.length > 0) {
    const bundleState = bundleMatchState(existing, sourceIds, excludedPageIds);
    if (bundleState !== "ambiguous" && bundleState !== undefined) return bundleState;
  }
  const identityAliases = [
    identity,
    ...(useSourceAliases ? sourceIds : []),
    ...aliases.filter((alias) => useSourceAliases || !isSourceIdentity(alias)),
  ].flatMap(legacyIdentityAliases);
  const candidates = available.filter(
    (row) =>
      row.automatedIdentity !== null &&
      identityAliases.some(
        (alias) =>
          row.automatedIdentity === alias || row.automatedIdentity?.startsWith(`${alias}-`),
      ),
  );
  const titleTokens = meaningfulTokens(title ?? "");
  return candidates.sort((left, right) => {
    const score = (row: ExistingAction) => {
      const identityTokens = meaningfulTokens(row.automatedIdentity ?? "");
      const actionTokens = meaningfulTokens(String(row.properties.Action ?? ""));
      const identityOverlap = identityTokens.filter((token) => titleTokens.includes(token)).length;
      const actionOverlap = actionTokens.filter((token) => titleTokens.includes(token)).length;
      const exactAlias = identityAliases.includes(row.automatedIdentity ?? "") ? 1 : 0;
      return identityOverlap * 10 + actionOverlap * 5 + exactAlias;
    };
    return score(right) - score(left);
  })[0];
}

type BundleMatch = ExistingAction | "ambiguous" | undefined;

export interface BundleReconciliationConflict {
  identity: string;
  title: string;
  sourceIds: ReadonlyArray<string>;
  reason: string;
}

/**
 * Match one active bundle across both membership shrink and normal weekly
 * growth. Any split or multiple overlap is ambiguous: callers must preserve
 * the existing rows and avoid creating a duplicate.
 */
function bundleMatchState(
  existing: ReadonlyArray<ExistingAction>,
  sourceIds: ReadonlyArray<string>,
  excludedPageIds: ReadonlySet<string> = new Set(),
): BundleMatch {
  const projected = new Set(sourceIds);
  const active = existing
    .filter(
      (row) =>
        !excludedPageIds.has(row.id) &&
        row.automatedIdentity?.startsWith("bundle:") &&
        row.properties["Canvas Item Type"] === "e-lecture" &&
        row.properties.Status !== "Done" &&
        row.properties.Status !== "Dropped",
    )
    .map((row) => ({ row, members: bundleMembers(row) }))
    .filter(({ members }) => [...members].some((member) => projected.has(member)));
  if (active.length === 0) return undefined;
  const contained = active.filter(
    ({ members }) =>
      [...members].every((member) => projected.has(member)) ||
      [...projected].every((member) => members.has(member)),
  );
  return contained.length === 1 && active.length === 1 ? contained[0]!.row : "ambiguous";
}

/** Surface an unsafe active-bundle overlap instead of silently dropping coverage. */
export function bundleReconciliationConflict(
  existing: ReadonlyArray<ExistingAction>,
  projection: Pick<TaskProjection, "id" | "title" | "sourceIds">,
  excludedPageIds: ReadonlySet<string> = new Set(),
): BundleReconciliationConflict | undefined {
  if (
    !projection.id.startsWith("bundle:") ||
    bundleMatchState(existing, projection.sourceIds, excludedPageIds) !== "ambiguous"
  ) {
    return undefined;
  }
  return {
    identity: projection.id,
    title: projection.title,
    sourceIds: [...projection.sourceIds],
    reason: "Multiple or split active lecture bundles overlap this projection",
  };
}

/**
 * Source IDs can be shared by distinct durable stages, so only use them as
 * migration aliases when they do not collide with another persisted stage.
 */
export function allowSourceAliases(
  state: ReconciliationState,
  logicalKey: string | undefined,
  sourceIds: ReadonlyArray<string>,
) {
  if (!logicalKey) return true;
  return !Object.values(state.tasks).some(
    (task) =>
      task.logicalKey !== undefined &&
      task.logicalKey !== logicalKey &&
      task.sourceIds.some((sourceId) => sourceIds.includes(sourceId)),
  );
}

function bundleMembers(row: ExistingAction) {
  const value = row.properties["Parent Canvas ID"];
  return new Set(typeof value === "string" ? value.split("\n").filter(Boolean) : []);
}

export function selectTrackedTasks(
  tasks: ReadonlyArray<TaskProjection>,
  existing: ReadonlyArray<ExistingAction>,
) {
  return tasks.filter(
    (task) =>
      task.state === "ready" ||
      task.state === "review" ||
      findExistingAction(existing, task.id, task.sourceIds, task.title, new Set(), task.aliases) !==
        undefined,
  );
}

function legacyIdentityAliases(identity: string): Array<string> {
  const aliases = [identity];
  const moduleItem = identity.match(/:module:[^:]+:item:([^:]+)$/)?.[1];
  if (moduleItem) aliases.push(moduleItem);
  const source = identity.match(
    /^course:[^:]+:(?:assignment|quiz|announcement|page|file|document|planner-item):(.+)$/,
  )?.[1];
  if (source) aliases.push(source);
  return aliases;
}

function isSourceIdentity(identity: string) {
  return /^course:[^:]+:(?:assignment|quiz|announcement|page|file|document|planner-item):/.test(
    identity,
  );
}

const IDENTITY_STOP_WORDS = new Set([
  "action",
  "assignment",
  "create",
  "prepare",
  "preparation",
  "review",
  "task",
  "the",
  "write",
]);

function meaningfulTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !IDENTITY_STOP_WORDS.has(token));
}

function changedProperties(
  current: Record<string, unknown>,
  desired: Record<string, unknown>,
  state: ReconciliationTaskState | undefined,
) {
  const patch: Record<string, unknown> = {};
  const conflicts: Array<string> = [];
  for (const [name, value] of Object.entries(desired)) {
    if (sameReconciliationValue(name, current[name], value)) continue;
    if (!state && BOOTSTRAP_PRESERVE_FIELDS.has(name) && Object.hasOwn(current, name)) {
      conflicts.push(name);
      continue;
    }
    if (state && Object.hasOwn(state.protectedFields ?? {}, name)) {
      if (!sameReconciliationValue(name, value, state.sourceProposal[name])) {
        conflicts.push(name);
      }
      continue;
    }
    if (state && Object.hasOwn(state.lastWritten, name)) {
      const userChanged = !sameReconciliationValue(name, current[name], state.lastWritten[name]);
      const sourceChanged = !sameReconciliationValue(name, value, state.sourceProposal[name]);
      if (userChanged && !sourceChanged) continue;
      if (userChanged && sourceChanged) {
        conflicts.push(name);
        continue;
      }
    }
    const overrideName =
      name === "Official Due" ? "dueAt" : name === "Available From" ? "availableFrom" : null;
    if (
      state?.review?.accepted &&
      overrideName &&
      Object.hasOwn(state.review.overrides, overrideName) &&
      sameReconciliationValue(name, current[name], state.review.overrides[overrideName]) &&
      !sameReconciliationValue(name, value, state.review.overrides[overrideName])
    ) {
      conflicts.push(name);
      continue;
    }
    patch[name] = value;
  }
  return { patch, conflicts };
}

const BOOTSTRAP_PRESERVE_FIELDS = new Set(["Available From", "Official Due"]);
const TERMINAL_STATUSES = new Set(["Done", "Dropped"]);

export function reconciliationProperties(projection: TaskProjection) {
  const properties: Record<string, unknown> = {
    "Canvas Course ID": String(courseIdFromIdentity(projection.memberSourceIds[0])),
    "Canvas Item ID": projection.id,
    "Canvas Item Type": projection.kind,
    "Parent Canvas ID": projection.memberSourceIds.join("\n"),
    Course: projection.courseCode,
    Readiness: readiness(projection),
    "Needs Review": projection.needsReview,
    "Blocked By": projection.blockedBy ?? null,
    Type: projection.needsReview
      ? "Review"
      : projection.kind === "assessment"
        ? /quiz/i.test(projection.title)
          ? "Quiz"
          : "Assignment"
        : "Preparation",
    "Work Mode": projection.workMode ?? (projection.kind === "e-lecture" ? "Online" : "Flexible"),
    ...(projection.state === "done" ? { Status: "Done" } : {}),
  };
  if (Object.hasOwn(projection, "availableFrom"))
    properties["Available From"] = projection.availableFrom;
  if (Object.hasOwn(projection, "dueAt")) properties["Official Due"] = projection.dueAt;
  if (Object.hasOwn(projection, "sourceUrl")) properties["Source URL"] = projection.sourceUrl;
  return properties;
}

function findStateByAlias(state: ReconciliationState, identity: string | null) {
  if (!identity) return undefined;
  return Object.values(state.tasks).find(
    (task) => task.logicalId === identity || task.aliases.includes(identity),
  );
}

function courseIdFromIdentity(identity: string | undefined) {
  return identity?.match(/^course:(\d+):/)?.[1] ?? "derived";
}

function isTerminalStatus(status: unknown) {
  return typeof status === "string" && TERMINAL_STATUSES.has(status);
}

function readiness(projection: TaskProjection) {
  if (projection.needsReview) return "Review";
  switch (projection.state) {
    case "ready":
      return "Ready";
    case "locked":
      return "Locked";
    case "waiting":
      return "Waiting on prerequisite";
    case "scheduled":
      return "Scheduled";
    case "done":
      return "Completed";
    default:
      return "Later";
  }
}
