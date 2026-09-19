import type { ExistingAction } from "./plan";

const REVIEWED_FIELDS = [
  "Status",
  "Notes",
  "Priority",
  "Effort",
  "Planned",
  "Start By",
  "Pinned",
  "Official Due",
  "Available From",
  "Needs Review",
  "Readiness",
  "Action",
] as const;

type UserValueDecision = {
  field: string;
  decision: "preserve-survivor" | "manual-merge-required";
  presentOn: Array<string>;
  survivorValue: unknown;
  otherValues: Array<{ pageId: string; value: unknown }>;
};

type Snapshot = {
  pageId: string;
  automatedIdentity: string | null;
  properties: Record<string, unknown>;
};

export interface MigrationReport {
  version: 2;
  survivors: Array<{
    logicalKey: string;
    pageId: string;
    currentIdentity: string | null;
    aliases: Array<string>;
    preservedUserFields: Array<string>;
    userValueDecisions: Array<UserValueDecision>;
    before: Snapshot;
  }>;
  duplicateArchivalProposals: Array<{
    pageId: string;
    survivorPageId: string;
    reason: string;
    reversible: true;
    archiveEligible: boolean;
    preservedUserFields: Array<string>;
    userValueDecisions: Array<UserValueDecision>;
    before: { survivor: Snapshot; duplicate: Snapshot };
    after: { survivor: Snapshot; duplicateArchived: true };
    rollback: { survivor: Snapshot; duplicateArchived: false };
  }>;
  conflicts: Array<{ logicalKey: string; pageIds: Array<string>; reason: string }>;
}

/** Read-only, deterministic report. It emits proposals only; it never archives or patches pages. */
export function planMigration(existing: ReadonlyArray<ExistingAction>): MigrationReport {
  const groups = new Map<string, Array<ExistingAction>>();
  for (const row of existing) {
    const key = migrationGroupKey(row);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const survivors: MigrationReport["survivors"] = [];
  const duplicateArchivalProposals: MigrationReport["duplicateArchivalProposals"] = [];
  const conflicts: MigrationReport["conflicts"] = [];
  for (const [logicalKey, rows] of groups) {
    const survivor = rows.slice().sort(compareSurvivors)[0]!;
    const aliases = rows.flatMap((row) => [
      ...(row.automatedIdentity ? [row.automatedIdentity] : []),
      ...parentIds(row),
    ]);
    const decisions = valueDecisions(rows, survivor);
    survivors.push({
      logicalKey,
      pageId: survivor.id,
      currentIdentity: survivor.automatedIdentity,
      aliases: [...new Set(aliases)],
      preservedUserFields: preservedFields(rows),
      userValueDecisions: decisions,
      before: snapshot(survivor),
    });
    for (const duplicate of rows) {
      if (duplicate.id === survivor.id) continue;
      const archiveEligible = decisions.every(
        (decision) => decision.decision === "preserve-survivor",
      );
      duplicateArchivalProposals.push({
        pageId: duplicate.id,
        survivorPageId: survivor.id,
        reason: archiveEligible
          ? "Same conservative course/kind/stage logical task; retain the canonical survivor"
          : "Manual merge required before archival; preserve the concrete before/after/rollback artifact",
        reversible: true,
        archiveEligible,
        preservedUserFields: preservedFields([duplicate]),
        userValueDecisions: decisions,
        before: { survivor: snapshot(survivor), duplicate: snapshot(duplicate) },
        after: { survivor: snapshot(survivor), duplicateArchived: true },
        rollback: { survivor: snapshot(survivor), duplicateArchived: false },
      });
    }
    const differing = conflictingFields(rows, survivor);
    if (differing.length > 0) {
      conflicts.push({
        logicalKey,
        pageIds: rows.map((row) => row.id),
        reason: `User and review fields differ or exist only on a duplicate and require an explicit merge decision: ${differing.join(", ")}`,
      });
    }
  }

  for (const conflict of bundleMembershipConflicts(existing)) conflicts.push(conflict);
  return { version: 2, survivors, duplicateArchivalProposals, conflicts };
}

function migrationGroupKey(row: ExistingAction) {
  if (!row.automatedIdentity) return null;
  const course = String(row.properties.Course ?? row.properties["Canvas Course ID"] ?? "");
  const kind = String(row.properties["Canvas Item Type"] ?? "");
  const stage = stageKey(String(row.properties.Action ?? ""));
  if (!course || !kind || !stage || kind === "e-lecture") return null;
  return `${course}:${kind}:${stage}`;
}

function stageKey(title: string) {
  const lower = title.toLowerCase();
  const quiz = lower.match(/\bquiz\s*(\d+)\b/);
  if (quiz) {
    const variant = lower
      .match(/\b(?:practice|mock|sample|graded|attempt\s*\d*)\b(?:\s*\d+)?/i)?.[0]
      ?.replace(/\s+/g, " ")
      .trim();
    return `quiz:${quiz[1]}:${variant ?? "canonical"}`;
  }
  const tutorial = lower.match(/\btutorial\s*(\d+)\b/);
  if (tutorial) return `tutorial:${tutorial[1]}`;
  const normalized = lower
    .replace(/\((?:chapter|week)\s*[^)]*\)/g, " ")
    .replace(/\b[a-z]{2,}\d{3,}[a-z0-9]*\b/g, " ")
    .replace(
      /\b(?:complete|attempt|submit|submission|online|create|prepare|review|watch|write|the|a|an|assignment|task|group)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function compareSurvivors(left: ExistingAction, right: ExistingAction) {
  return survivorScore(right) - survivorScore(left) || left.id.localeCompare(right.id);
}

function survivorScore(row: ExistingAction) {
  const identity = row.automatedIdentity ?? "";
  return (
    (/:assignment:|:quiz:/.test(identity) ? 100 : 0) +
    (row.properties.Status === "Done" || row.properties.Status === "Dropped" ? 30 : 0) +
    parentIds(row).length
  );
}

function parentIds(row: ExistingAction) {
  const value = row.properties["Parent Canvas ID"];
  return typeof value === "string" ? value.split("\n").filter(Boolean) : [];
}

function preservedFields(rows: ReadonlyArray<ExistingAction>) {
  return REVIEWED_FIELDS.filter((field) => rows.some((row) => hasValue(row.properties[field])));
}

function conflictingFields(rows: ReadonlyArray<ExistingAction>, survivor: ExistingAction) {
  return valueDecisions(rows, survivor)
    .filter((decision) => decision.decision === "manual-merge-required")
    .map((decision) => decision.field);
}

function valueDecisions(rows: ReadonlyArray<ExistingAction>, survivor: ExistingAction) {
  return REVIEWED_FIELDS.flatMap((field) => {
    const presentOn = rows.filter((row) => hasValue(row.properties[field])).map((row) => row.id);
    if (presentOn.length === 0) return [];
    const survivorValue = survivor.properties[field] ?? null;
    const otherValues = rows
      .filter((row) => row.id !== survivor.id && hasValue(row.properties[field]))
      .map((row) => ({ pageId: row.id, value: row.properties[field] }));
    const survivorHasValue = hasValue(survivor.properties[field]);
    const uniqueOtherValues = new Set(otherValues.map(({ value }) => JSON.stringify(value)));
    const sameAsSurvivor = otherValues.every(
      ({ value }) => JSON.stringify(value) === JSON.stringify(survivorValue),
    );
    return [
      {
        field,
        decision:
          otherValues.length > 0 &&
          (!survivorHasValue || uniqueOtherValues.size > 1 || !sameAsSurvivor)
            ? ("manual-merge-required" as const)
            : ("preserve-survivor" as const),
        presentOn,
        survivorValue,
        otherValues,
      },
    ];
  });
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function snapshot(row: ExistingAction): Snapshot {
  return {
    pageId: row.id,
    automatedIdentity: row.automatedIdentity,
    properties: { ...row.properties },
  };
}

function bundleMembershipConflicts(existing: ReadonlyArray<ExistingAction>) {
  const bundles = existing.filter(
    (row) =>
      row.properties["Canvas Item Type"] === "e-lecture" && row.properties.Status !== "Dropped",
  );
  const conflicts: MigrationReport["conflicts"] = [];
  for (const row of bundles) {
    const members = new Set(parentIds(row));
    if (members.size === 0) continue;
    for (const older of bundles) {
      if (older.id === row.id) continue;
      const olderMembers = new Set(parentIds(older));
      if (olderMembers.size === 0 || ![...olderMembers].every((member) => members.has(member)))
        continue;
      if (members.size <= olderMembers.size) continue;
      const terminal = older.properties.Status === "Done" || older.properties.Status === "Dropped";
      if (!terminal) continue;
      conflicts.push({
        logicalKey: `${String(row.properties.Course)}:e-lecture:bundle-membership`,
        pageIds: [older.id, row.id],
        reason:
          "Active bundle contains members from a terminal bundle; reproject membership before archival",
      });
    }
  }
  return conflicts;
}
