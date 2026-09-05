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
  "Type",
  "Work Mode",
  "Source State",
  "Missing Syncs",
  "Start By",
] as const;

export interface ExistingAction {
  id: string;
  automatedIdentity: string | null;
  properties: Record<string, unknown>;
  archived?: boolean;
  editedAt?: string;
  migrationDisposition?: "retire" | "preserve";
}

export type ReconcileOperation = (
  | { type: "create"; identity: string; properties: Record<string, unknown> }
  | { type: "update"; pageId: string; identity: string; properties: Record<string, unknown> }
) & {
  expectedIdentity?: string;
  expectedProperties?: Record<string, unknown>;
  archived?: boolean;
  managedNotes?: string;
};

export function planReconciliation(
  existing: ReadonlyArray<ExistingAction>,
  projections: ReadonlyArray<TaskProjection>,
  syncedAt: string,
): Array<ReconcileOperation> {
  const claimedPageIds = new Set<string>();
  return projections.flatMap((projection) => {
    const properties: Record<string, unknown> = projectionProperties(projection, syncedAt);
    const current = findExistingAction(
      existing,
      projection.id,
      projection.sourceIds,
      projection.title,
      claimedPageIds,
    );
    if (!current && projection.id.startsWith("candidate:")) {
      const collision = existing.find(
        (row) =>
          row.automatedIdentity &&
          row.migrationDisposition !== "retire" &&
          !["Done", "Dropped"].includes(String(row.properties.Status)) &&
          row.properties.Course === projection.courseCode &&
          !row.automatedIdentity.startsWith("candidate:") &&
          projection.sourceIds.some(
            (id) =>
              row.automatedIdentity === id ||
              legacyIdentityAliases(id).some(
                (alias) =>
                  row.automatedIdentity === alias || row.automatedIdentity?.startsWith(`${alias}-`),
              ),
          ),
      );
      if (collision)
        throw new Error(
          `Explicit legacy action mapping required for ${projection.id}; existing page ${collision.id}`,
        );
    }
    if (current) {
      claimedPageIds.add(current.id);
      if (current.properties.Status === "Done" || current.properties.Status === "Dropped") {
        delete properties.Status;
        properties.Readiness = current.properties.Status === "Done" ? "Completed" : "Later";
        properties["Needs Review"] = false;
      }
      if (current.properties.Pinned === true) delete properties.Planned;
    }
    const managedNotes = [projection.instructions, projection.reason].filter(Boolean).join("\n\n");
    if (
      current &&
      !current.archived &&
      !managedNotes &&
      propertiesEqual(current.properties, properties)
    )
      return [];
    return [
      current
        ? {
            type: "update" as const,
            pageId: current.id,
            identity: projection.id,
            properties,
            expectedIdentity: String(
              current.properties["Canvas Item ID"] ?? current.automatedIdentity,
            ),
            expectedProperties: current.properties,
            archived: false,
            ...(managedNotes ? { managedNotes } : {}),
          }
        : ({
            type: "create",
            identity: projection.id,
            properties: {
              ...properties,
              Action: projection.title,
              Status:
                projection.state === "done"
                  ? "Done"
                  : projection.inProgress
                    ? "Doing"
                    : "Not started",
              ...(managedNotes ? { Notes: managedNotes } : {}),
            },
          } as const),
    ];
  });
}

export function findExistingAction(
  existing: ReadonlyArray<ExistingAction>,
  identity: string,
  sourceIds: ReadonlyArray<string>,
  _title?: string,
  excludedPageIds: ReadonlySet<string> = new Set(),
) {
  const available = existing.filter(
    (row) =>
      !excludedPageIds.has(row.id) &&
      row.automatedIdentity &&
      row.migrationDisposition !== "retire",
  );
  const exact = available.filter((row) => row.automatedIdentity === identity);
  if (exact.length > 1) throw new Error(`Duplicate automated identity: ${identity}`);
  if (exact[0]) return exact[0];
  if (!/^course:\d+:(assignment|quiz|module):/.test(identity)) return undefined;
  const courseId = [identity, ...sourceIds]
    .map((id) => id.match(/^course:(\d+):/)?.[1])
    .find(Boolean);
  const aliases = [identity, ...sourceIds].flatMap(legacyIdentityAliases);
  const candidates = available.filter(
    (row) =>
      String(row.properties["Canvas Course ID"]) === courseId &&
      aliases.includes(row.automatedIdentity!) &&
      /^(assessment|assignment|quiz|preparation|e-lecture)$/i.test(
        String(row.properties["Canvas Item Type"] ?? ""),
      ),
  );
  if (candidates.length > 1)
    throw new Error(`Ambiguous legacy identities for ${identity}; explicit migration required`);
  return candidates[0];
}

export function selectTrackedTasks(
  tasks: ReadonlyArray<TaskProjection>,
  existing: ReadonlyArray<ExistingAction>,
) {
  return tasks.filter(
    (task) =>
      task.state === "ready" ||
      task.state === "scheduled" ||
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

function propertiesEqual(current: Record<string, unknown>, desired: Record<string, unknown>) {
  return Object.entries(desired).every(
    ([name, value]) =>
      name === "Last Synced" ||
      JSON.stringify(current[name] ?? null) === JSON.stringify(value ?? null),
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
    "Source State": "Active",
    "Missing Syncs": 0,
    ...(projection.startBy !== undefined ? { "Start By": projection.startBy } : {}),
    ...(projection.planned !== undefined ? { Planned: projection.planned } : {}),
    ...(projection.inProgress && !projection.userStatus ? { Status: "Doing" } : {}),
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
