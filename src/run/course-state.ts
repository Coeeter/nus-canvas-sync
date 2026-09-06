import { createHash } from "node:crypto";
import type { TaskFact, TaskProjection } from "../domain/task";
import { sourceDate, validSourceDate } from "../normalize/dates";
import type { NormalizedRecord } from "../normalize/types";
import type { ExistingAction, ReconcileOperation } from "../reconcile/plan";
import { findExistingAction } from "../reconcile/plan";
import type { CourseState } from "../state/course-store";

export function evidenceFingerprint(fact: TaskFact, records: ReadonlyArray<NormalizedRecord>) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        records
          .filter((record) =>
            fact.sourceIds.some((id) => id === record.id || id.startsWith(`${record.id}:item:`)),
          )
          .map((record) => [record.id, record.contentHash])
          .sort(),
      ),
    )
    .digest("hex");
}

export function restoreUserDecisions(
  facts: ReadonlyArray<TaskFact>,
  existing: ReadonlyArray<ExistingAction>,
  records: ReadonlyArray<NormalizedRecord>,
  state: CourseState,
): Array<TaskFact> {
  // Existing generated bundles have explicit member identities, so they can
  // be adopted without guessing from labels during the state-format migration.
  for (const row of existing) {
    if (
      row.migrationDisposition === "retire" ||
      !row.automatedIdentity?.startsWith(`bundle:${records[0]?.courseCode}:`) ||
      state.managed[row.automatedIdentity]
    )
      continue;
    const members = String(row.properties["Parent Canvas ID"] ?? "")
      .split("\n")
      .filter(Boolean);
    if (!members.length || !members.every((id) => /^course:\d+:module:\d+:item:\d+$/.test(id)))
      continue;
    state.managed[row.automatedIdentity] = {
      pageId: row.id,
      sourceIds: members,
      missing: 0,
      lastSeenRun: "",
    };
  }
  // Apply explicit user transitions in edit order; unchanged terminal bundles
  // must not undo a later decision to reopen one of their members.
  for (const row of [...existing].sort((left, right) =>
    (left.editedAt ?? "").localeCompare(right.editedAt ?? ""),
  )) {
    if (
      row.migrationDisposition === "retire" ||
      !row.automatedIdentity ||
      row.properties.Course !== records[0]?.courseCode
    )
      continue;
    const members = String(row.properties["Parent Canvas ID"] ?? "")
      .split("\n")
      .filter((id) => /^course:\d+:module:\d+:item:\d+$/.test(id));
    if (!members.length) continue;
    const status = String(row.properties.Status ?? "Not started");
    const previous = state.memberChoices[row.id];
    if (previous?.status === status) continue;
    const terminal = status === "Done" || status === "Dropped";
    if (terminal || previous?.status === "Done" || previous?.status === "Dropped") {
      for (const [pageId, choice] of Object.entries(state.memberChoices))
        state.memberChoices[pageId] = {
          ...choice,
          members: choice.members.filter((id) => !members.includes(id)),
        };
    }
    state.memberChoices[row.id] = { status, members: terminal ? members : [] };
  }
  state.terminalMembers = {};
  for (const choice of Object.values(state.memberChoices))
    if (choice.status === "Done" || choice.status === "Dropped")
      for (const id of choice.members) state.terminalMembers[id] = choice.status;
  return facts.map((fact) => {
    const row = findExistingAction(existing, fact.id, fact.sourceIds, fact.title);
    const status = row?.properties.Status;
    const memberStatuses = fact.sourceIds.map((id) => state.terminalMembers[id]);
    const terminal =
      status === "Done" || status === "Dropped"
        ? status
        : fact.kind === "e-lecture" && memberStatuses.length && memberStatuses.every(Boolean)
          ? memberStatuses.every((value) => value === "Done")
            ? "Done"
            : "Dropped"
          : undefined;
    let result: TaskFact = { ...fact, ...(terminal ? { userStatus: terminal } : {}) };
    const fingerprint = evidenceFingerprint(fact, records);
    const previousReview = state.reviewFingerprints[fact.id];
    const due = row?.properties["Official Due"];
    const available = row?.properties["Available From"];
    const valid = (date: unknown) =>
      date == null || (typeof date === "string" && validSourceDate(date));
    if (
      fact.conflict &&
      previousReview === fingerprint &&
      row?.properties["Needs Review"] === false &&
      valid(due) &&
      valid(available) &&
      (due != null || !/deadline|dueAt|dates/i.test(fact.conflict.reason))
    ) {
      state.resolutions[fact.id] = {
        fingerprint,
        dueAt: typeof due === "string" ? due : null,
        availableFrom: typeof available === "string" ? available : null,
      };
    }
    const resolution = state.resolutions[fact.id];
    if (fact.conflict && resolution?.fingerprint === fingerprint) {
      const { conflict: _, ...resolved } = result;
      result = {
        ...resolved,
        dueAt: resolution.dueAt,
        availableFrom: resolution.availableFrom,
        authoritativeAction: true,
      };
    } else if (fact.conflict) state.reviewFingerprints[fact.id] = fingerprint;
    return result;
  });
}

export function planDates(
  task: TaskProjection,
  now: Date,
  records: ReadonlyArray<NormalizedRecord> = [],
): TaskProjection {
  if (["expired", "inactive", "locked", "waiting", "expected", "review"].includes(task.state))
    return { ...task, planned: null };
  if (task.state !== "ready") return task;
  const sgt = (date: Date) => new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  if (task.kind === "e-lecture") {
    const today = new Date(`${sgt(now)}T00:00:00+08:00`);
    const weekday = new Date(today.getTime() + 8 * 3600_000).getUTCDay();
    return { ...task, planned: sgt(new Date(today.getTime() + ((7 - weekday) % 7) * 86400_000)) };
  }
  // Briefs may be inline Canvas prose or extracted attachments. Use their bodies,
  // not titles, link attributes, or the model's abbreviated action.
  const brief = records
    .filter(
      (record) =>
        record.courseCode === task.courseCode &&
        (task.sourceIds.includes(record.id) ||
          (Array.isArray(record.fields.referencedBy) &&
            record.fields.referencedBy.some((id) => task.sourceIds.includes(id)))),
    )
    .map((record) => {
      const body =
        record.kind === "document"
          ? record.fields.text
          : record.kind === "assignment" || record.kind === "quiz"
            ? record.fields.description
            : record.kind === "page"
              ? record.fields.body
              : record.kind === "announcement"
                ? record.fields.message
                : null;
      return typeof body === "string" ? body.replace(/<\/?[A-Za-z][^>]*>/g, " ").trim() : "";
    })
    .join("\n");
  if (task.kind === "assessment" && task.dueAt && brief.trim()) {
    const days = /group|team|multi.stage/i.test(brief)
      ? 14
      : /report|essay|research|article/i.test(brief)
        ? 7
        : 3;
    const start = new Date(sourceDate(task.dueAt).getTime() - days * 86400_000);
    const startBy = sgt(start);
    return { ...task, startBy, ...(sgt(now) >= startBy ? { planned: sgt(now) } : {}) };
  }
  return task;
}

export function reconcileMissing(
  state: CourseState,
  tasks: ReadonlyArray<TaskProjection>,
  records: ReadonlyArray<NormalizedRecord>,
  existing: ReadonlyArray<ExistingAction>,
): Array<ReconcileOperation> {
  const ids = new Set(tasks.map((task) => task.id));
  const present = (source: string) =>
    records.some(
      (record) =>
        record.id === source ||
        (source.startsWith(`${record.id}:item:`) &&
          Array.isArray(record.fields.items) &&
          record.fields.items.some((item) => `${record.id}:item:${item.id}` === source)),
    );
  const operations: Array<ReconcileOperation> = [];
  for (const [identity, managed] of Object.entries(state.managed)) {
    if (ids.has(identity)) continue;
    const row = existing.find((action) => action.id === managed.pageId);
    if (!row || row.automatedIdentity !== identity)
      throw new Error(`Managed row changed ownership or is unavailable: ${identity}`);
    const supersededBundle =
      identity.startsWith("bundle:") &&
      managed.sourceIds.every(
        (id) => tasks.some((task) => task.sourceIds.includes(id)) || state.terminalMembers[id],
      );
    const primaryAssessment = /^course:\d+:(assignment|quiz):\d+$/.test(identity);
    const sourceStillPresent = primaryAssessment
      ? present(identity)
      : managed.sourceIds.some(present);
    if (!supersededBundle && sourceStillPresent) {
      if (row.properties.Status === "Done" || row.properties.Status === "Dropped") continue;
      // Extraction loss is not deletion evidence. Retain the previous generation.
      throw new Error(
        `Interpretation lost a managed action while its source still exists: ${identity}`,
      );
    }
    const missing = Math.min(2, managed.missing + (managed.lastSeenRun === state.runId ? 0 : 1));
    state.managed[identity] = { ...managed, missing, lastSeenRun: state.runId };
    operations.push({
      type: "update",
      pageId: row.id,
      identity,
      expectedIdentity: identity,
      expectedProperties: row.properties,
      archived: supersededBundle || missing >= 2,
      properties: {
        "Source State": "Missing",
        "Missing Syncs": missing,
        "Last Synced": state.syncedAt,
        Readiness: row.properties.Status === "Done" ? "Completed" : "Review",
        "Needs Review": row.properties.Status !== "Done" && row.properties.Status !== "Dropped",
        "Blocked By": null,
        ...(row.properties.Pinned === true ? {} : { Planned: null }),
      },
    });
  }
  return operations;
}
