import type { TaskProjection } from "../domain/task";

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
] as const;

export interface ExistingAction {
  id: string;
  automatedIdentity: string | null;
  properties: Record<string, unknown>;
}

export type ReconcileOperation =
  | { type: "create"; identity: string; properties: Record<string, unknown> }
  | { type: "update"; pageId: string; identity: string; properties: Record<string, unknown> };

export function planReconciliation(
  existing: ReadonlyArray<ExistingAction>,
  projections: ReadonlyArray<TaskProjection>,
  syncedAt: string,
): Array<ReconcileOperation> {
  const claimedPageIds = new Set<string>();
  return projections.flatMap((projection) => {
    const properties = projectionProperties(projection, syncedAt);
    const current = findExistingAction(
      existing,
      projection.id,
      projection.sourceIds,
      projection.title,
      claimedPageIds,
    );
    if (current) claimedPageIds.add(current.id);
    if (current && propertiesEqual(current.properties, properties)) return [];
    return [
      current
        ? { type: "update" as const, pageId: current.id, identity: projection.id, properties }
        : ({
            type: "create",
            identity: projection.id,
            properties: {
              ...properties,
              Action: projection.title,
              Status: projection.state === "done" ? "Done" : "Not started",
              ...(projection.needsReview && projection.reason ? { Notes: projection.reason } : {}),
            },
          } as const),
    ];
  });
}

export function findExistingAction(
  existing: ReadonlyArray<ExistingAction>,
  identity: string,
  sourceIds: ReadonlyArray<string>,
  title?: string,
  excludedPageIds: ReadonlySet<string> = new Set(),
) {
  const available = existing.filter((row) => !excludedPageIds.has(row.id));
  const exact = available.find((row) => row.automatedIdentity === identity);
  if (exact) return exact;
  const aliases = [identity, ...sourceIds].flatMap(legacyIdentityAliases);
  const candidates = available.filter(
    (row) =>
      row.automatedIdentity !== null &&
      aliases.some(
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
      const exactAlias = aliases.includes(row.automatedIdentity ?? "") ? 1 : 0;
      return identityOverlap * 10 + actionOverlap * 5 + exactAlias;
    };
    return score(right) - score(left);
  })[0];
}

export function selectTrackedTasks(
  tasks: ReadonlyArray<TaskProjection>,
  existing: ReadonlyArray<ExistingAction>,
) {
  return tasks.filter(
    (task) =>
      task.state === "ready" ||
      task.state === "review" ||
      findExistingAction(existing, task.id, task.sourceIds, task.title) !== undefined,
  );
}

function legacyIdentityAliases(identity: string): Array<string> {
  const moduleItem = identity.match(/:module:[^:]+:item:([^:]+)$/)?.[1];
  if (moduleItem) return [moduleItem];
  const source = identity.match(
    /^course:[^:]+:(?:assignment|quiz|announcement|page|file|document|planner-item):(.+)$/,
  )?.[1];
  return source ? [source] : [];
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

function propertiesEqual(current: Record<string, unknown>, desired: Record<string, unknown>) {
  return Object.entries(desired).every(
    ([name, value]) => JSON.stringify(current[name] ?? null) === JSON.stringify(value ?? null),
  );
}

function projectionProperties(projection: TaskProjection, syncedAt: string) {
  return {
    "Canvas Course ID": String(courseIdFromIdentity(projection.memberSourceIds[0])),
    "Canvas Item ID": projection.id,
    "Canvas Item Type": projection.kind,
    "Parent Canvas ID": projection.memberSourceIds.join("\n"),
    Course: projection.courseCode,
    Readiness: readiness(projection),
    "Needs Review": projection.needsReview,
    "Available From": projection.availableFrom ?? null,
    "Official Due": projection.dueAt ?? null,
    "Source URL": projection.sourceUrl ?? null,
    "Last Synced": syncedAt,
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
}

function courseIdFromIdentity(identity: string | undefined) {
  return identity?.match(/^course:(\d+):/)?.[1] ?? "derived";
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
