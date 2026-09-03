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
  const automated = new Map(
    existing.filter((row) => row.automatedIdentity).map((row) => [row.automatedIdentity!, row]),
  );
  return projections.flatMap((projection) => {
    const properties = projectionProperties(projection, syncedAt);
    const current = automated.get(projection.id);
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
    Type: projection.needsReview
      ? "Review"
      : projection.kind === "assessment"
        ? /quiz/i.test(projection.title)
          ? "Quiz"
          : "Assignment"
        : "Preparation",
    "Work Mode": projection.kind === "e-lecture" ? "Online" : "Flexible",
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
    case "done":
      return "Completed";
    default:
      return "Later";
  }
}
