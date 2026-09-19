import { createHash } from "node:crypto";
import type { TaskFact } from "../domain/task";
import type {
  ReconciliationState,
  ReconciliationTaskState,
  ReviewResolution,
} from "../state/reconcile-store";
import {
  allowSourceAliases,
  type ExistingAction,
  findExistingAction,
  type ReconcileOperation,
  reconciliationProperties,
} from "./plan";
import { deriveReviewIssue, reviewIssueFingerprint } from "./review-issue";
import { isDateBefore, normalizeDateValue, sameReconciliationValue } from "./values";

const TERMINAL = new Set(["Done", "Dropped"]);

export function reviewRevision(fact: TaskFact) {
  const conflict = fact.conflict;
  if (!conflict) return null;
  const payload = JSON.stringify({
    id: fact.id,
    logicalKey: fact.logicalKey ?? null,
    kind: fact.kind,
    issue: reviewIssueFingerprint(
      conflict.issue ??
        deriveReviewIssue(conflict.reason, {
          availableFrom: fact.availableFrom,
          dueAt: fact.dueAt,
          eventEndsAt: fact.eventEndsAt,
        }),
    ),
    availableFrom: own(fact, "availableFrom") ? normalizeDateValue(fact.availableFrom) : "unknown",
    dueAt: own(fact, "dueAt") ? normalizeDateValue(fact.dueAt) : "unknown",
    eventEndsAt: own(fact, "eventEndsAt") ? normalizeDateValue(fact.eventEndsAt) : "unknown",
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

export function applyUserState(
  fact: TaskFact,
  row: ExistingAction | undefined,
  stored: ReconciliationTaskState | undefined,
): TaskFact {
  const properties = row?.properties ?? {};
  const status = properties.Status;
  const rawSourceProposal = fact.sourceProposal ?? rawDateSourceProposal(fact);
  let result: TaskFact = {
    ...fact,
    ...(Object.keys(rawSourceProposal).length > 0 ? { sourceProposal: rawSourceProposal } : {}),
  };
  if (isTerminalStatus(status)) result = { ...result, userStatus: status };

  const currentNeedsReview = properties["Needs Review"];
  const storedReview = stored?.review;
  const protectedOverrides = readCorrectionOverrides(stored?.protectedFields ?? {}, true);
  const protectedChanges = protectedCorrectionChanges(fact, stored);
  const proposedOverrides = {
    ...(storedReview?.overrides ?? {}),
    ...protectedOverrides,
    ...readCorrectionOverrides(properties, false),
  };
  const unsafeAvailabilityCorrection =
    Object.hasOwn(proposedOverrides, "availableFrom") &&
    fact.availableFrom != null &&
    (proposedOverrides.availableFrom == null ||
      isDateBefore(proposedOverrides.availableFrom, fact.availableFrom));
  const safeProtectedOverrides = Object.fromEntries(
    Object.entries(protectedOverrides).filter(([name]) => {
      if (protectedChanges.some((change) => change.overrideName === name)) return false;
      const property = name === "dueAt" ? "Official Due" : "Available From";
      if (
        Object.hasOwn(properties, property) &&
        !sameReconciliationValue(
          property,
          properties[property],
          stored?.protectedFields?.[property],
        )
      ) {
        return false;
      }
      return name !== "availableFrom" || !unsafeAvailabilityCorrection;
    }),
  );
  result = applyCorrectionOverrides(result, safeProtectedOverrides);
  if (protectedChanges.length > 0 && !result.conflict) {
    const change = protectedChanges[0]!;
    result = {
      ...result,
      conflict: {
        reason: `${change.property} changed after a preserved bootstrap correction`,
        sources: fact.sourceIds,
        issue: {
          kind: "source-correction-changed",
          field: change.property,
          values: [change.sourceValue, change.protectedValue],
        },
      },
    };
  }
  const revision = reviewRevision(result);
  const acceptingProtectedCorrection =
    storedReview?.accepted === false &&
    currentNeedsReview === false &&
    properties.Readiness === "Review" &&
    Object.keys(protectedOverrides).length > 0 &&
    (!fact.conflict ||
      reviewRevision(fact) === storedReview.revision ||
      revision === storedReview.revision);
  const isKnownLegacyTask =
    fact.conflict?.reason ===
      "Candidate has no durable logical key or validated canonical task match" &&
    row?.automatedIdentity !== null &&
    row?.automatedIdentity !== undefined &&
    fact.aliases?.includes(row.automatedIdentity) === true &&
    currentNeedsReview !== true;
  if (isKnownLegacyTask) {
    const { conflict: _conflict, ...withoutConflict } = result;
    result = withoutConflict;
  }
  const accepted =
    (Boolean(fact.conflict) || Boolean(result.conflict) || acceptingProtectedCorrection) &&
    !unsafeAvailabilityCorrection &&
    currentNeedsReview === false &&
    (acceptingProtectedCorrection ||
      storedReview === undefined ||
      storedReview.revision === revision) &&
    (storedReview !== undefined || properties.Readiness === "Review");

  if (accepted) {
    const currentOverrides = readCorrectionOverrides(properties, false);
    if (
      (storedReview?.accepted === true || acceptingProtectedCorrection) &&
      Object.hasOwn(properties, "Official Due") &&
      properties["Official Due"] === null
    ) {
      currentOverrides.dueAt = null;
    }
    if (
      (storedReview?.accepted === true || acceptingProtectedCorrection) &&
      Object.hasOwn(properties, "Available From") &&
      properties["Available From"] === null
    ) {
      currentOverrides.availableFrom = null;
    }
    const overrides = {
      ...(storedReview?.overrides ?? {}),
      ...currentOverrides,
    };
    const { conflict: _conflict, ...withoutConflict } = result;
    result = {
      ...withoutConflict,
      reviewResolution: {
        revision: revision ?? storedReview?.revision ?? "bootstrap",
        overrides,
      },
      ...(hasOwn(overrides, "dueAt") ? { dueAt: overrides.dueAt as string | null } : {}),
      ...(hasOwn(overrides, "availableFrom")
        ? { availableFrom: overrides.availableFrom as string | null }
        : {}),
    };
  } else if (storedReview?.accepted && revision !== storedReview.revision) {
    // A new source-backed conflict is allowed to reopen an old acceptance.
    result = result.conflict || !fact.conflict ? result : { ...result, conflict: fact.conflict };
  } else if (!fact.conflict && currentNeedsReview === true) {
    result = {
      ...result,
      conflict: {
        reason: "Existing Notion review remains unresolved",
        sources: fact.sourceIds,
      },
    };
  }
  return result;
}

function applyCorrectionOverrides(fact: TaskFact, overrides: Record<string, unknown>): TaskFact {
  return {
    ...fact,
    ...(hasOwn(overrides, "dueAt") ? { dueAt: overrides.dueAt as string | null } : {}),
    ...(hasOwn(overrides, "availableFrom")
      ? { availableFrom: overrides.availableFrom as string | null }
      : {}),
  };
}

function rawDateSourceProposal(fact: TaskFact): Record<string, unknown> {
  return {
    ...(own(fact, "availableFrom") ? { "Available From": fact.availableFrom } : {}),
    ...(own(fact, "dueAt") ? { "Official Due": fact.dueAt } : {}),
  };
}

function protectedCorrectionChanges(fact: TaskFact, stored: ReconciliationTaskState | undefined) {
  const changes: Array<{
    property: "Official Due" | "Available From";
    overrideName: "dueAt" | "availableFrom";
    sourceValue: unknown;
    protectedValue: unknown;
  }> = [];
  for (const [property, overrideName, factValue] of [
    ["Official Due", "dueAt", fact.dueAt],
    ["Available From", "availableFrom", fact.availableFrom],
  ] as const) {
    if (!Object.hasOwn(stored?.protectedFields ?? {}, property)) continue;
    const protectedValue = stored?.protectedFields?.[property];
    if (sameReconciliationValue(property, factValue, protectedValue)) continue;
    // A legacy/AI-unknown source field is not a source change merely because
    // the preserved row currently contains null. It remains safe for the
    // user to resolve that review with an explicit value.
    if (factValue === undefined && !Object.hasOwn(stored?.sourceProposal ?? {}, property)) {
      continue;
    }
    if (
      !Object.hasOwn(stored?.sourceProposal ?? {}, property) ||
      !sameReconciliationValue(property, factValue, stored?.sourceProposal[property])
    ) {
      changes.push({
        property,
        overrideName,
        sourceValue: factValue,
        protectedValue,
      });
    }
  }
  return changes;
}

export function readCorrectionOverrides(properties: Record<string, unknown>, includeNull = false) {
  const overrides: Record<string, unknown> = {};
  if (
    Object.hasOwn(properties, "Official Due") &&
    (includeNull || properties["Official Due"] !== null)
  ) {
    overrides.dueAt = normalizeDateValue(properties["Official Due"] ?? null);
  }
  if (
    Object.hasOwn(properties, "Available From") &&
    (includeNull || properties["Available From"] !== null)
  ) {
    overrides.availableFrom = normalizeDateValue(properties["Available From"] ?? null);
  }
  return overrides;
}

export function isTerminalStatus(status: unknown): status is "Done" | "Dropped" {
  return typeof status === "string" && TERMINAL.has(status);
}

/** Find persisted state without allowing a source alias to cross durable stages. */
export function stateForTask(
  state: ReconciliationState,
  logicalId: string,
  aliases: ReadonlyArray<string> = [],
  logicalKey?: string,
) {
  if (state.tasks[logicalId]) return state.tasks[logicalId];
  return Object.values(state.tasks).find(
    (task) =>
      compatibleLogicalKey(logicalKey, task.logicalKey) &&
      [task.logicalId, ...task.aliases].some((identity) =>
        [logicalId, ...aliases].includes(identity),
      ),
  );
}

/** Aliases may migrate a task's page only after its durable stage is compatible. */
export function stateAliases(
  task: ReconciliationTaskState | undefined,
  logicalKey?: string,
): Array<string> {
  if (!task || !compatibleLogicalKey(logicalKey, task.logicalKey)) return [];
  return [task.logicalId, ...task.aliases];
}

export function stateAfterVerifiedWrites(
  previous: ReconciliationState,
  existing: ReadonlyArray<ExistingAction>,
  projections: ReadonlyArray<import("../domain/task").TaskProjection>,
  operations: ReadonlyArray<ReconcileOperation>,
): ReconciliationState {
  const tasks: Record<string, ReconciliationTaskState> = { ...previous.tasks };
  for (const projection of projections) {
    const existingState = stateForTask(
      previous,
      projection.id,
      [...projection.sourceIds, ...(projection.aliases ?? [])],
      projection.logicalKey,
    );
    const row = findExistingAction(
      existing,
      projection.id,
      projection.sourceIds,
      projection.title,
      new Set(),
      [...(projection.aliases ?? []), ...stateAliases(existingState, projection.logicalKey)],
      allowSourceAliases(previous, projection.logicalKey, projection.sourceIds),
    );
    const desired = reconciliationProperties(projection);
    // planCourse carries the raw source-backed proposal through the projection
    // boundary. Falling back to desired keeps direct callers and old tests
    // compatible, while production state never derives provenance from a
    // user-corrected projection.
    const rawSourceProposal = projection.sourceProposal ?? desired;
    const protectedChanges = protectedCorrectionChanges(projection, existingState);
    const protectedFields = { ...(existingState?.protectedFields ?? {}) };
    const operation = operations.find(
      (item) =>
        item.identity === projection.id && (item.type === "create" || item.pageId === row?.id),
    );
    const lastWritten = { ...(existingState?.lastWritten ?? {}) };
    if (operation) {
      for (const [name, value] of Object.entries(operation.properties)) {
        // Rebase may intentionally omit a field after a user edit. Only
        // advance ownership when the verified page contains the value that
        // this operation proposed.
        if (sameReconciliationValue(name, row?.properties[name], value)) lastWritten[name] = value;
      }
    }
    if (!existingState) {
      for (const name of ["Available From", "Official Due"]) {
        if (
          Object.hasOwn(row?.properties ?? {}, name) &&
          (!Object.hasOwn(desired, name) ||
            !sameReconciliationValue(name, row?.properties[name], desired[name]))
        ) {
          protectedFields[name] = normalizeDateValue(row?.properties[name]);
        }
      }
    } else {
      for (const name of Object.keys(protectedFields)) {
        if (Object.hasOwn(row?.properties ?? {}, name)) {
          protectedFields[name] = normalizeDateValue(row?.properties[name]);
        }
      }
    }
    const sourceProposal = { ...(existingState?.sourceProposal ?? {}) };
    for (const [name, value] of Object.entries(rawSourceProposal)) {
      const correctionName =
        name === "Official Due" ? "dueAt" : name === "Available From" ? "availableFrom" : null;
      const protectedUnchanged =
        existingState !== undefined &&
        correctionName !== null &&
        Object.hasOwn(protectedFields, name) &&
        !protectedChanges.some((change) => change.overrideName === correctionName);
      const acceptedOverride =
        correctionName !== null &&
        existingState?.review?.accepted === true &&
        Object.hasOwn(existingState.review.overrides, correctionName) &&
        sameReconciliationValue(name, value, existingState.review.overrides[correctionName]);
      if (!protectedUnchanged && !acceptedOverride) sourceProposal[name] = value;
    }
    const aliases = [
      ...new Set([
        ...(existingState?.aliases ?? []),
        ...(projection.aliases ?? []),
        ...projection.sourceIds,
        ...(row?.automatedIdentity ? [row.automatedIdentity] : []),
      ]),
    ];
    let review = existingState?.review;
    if (projection.needsReview) {
      review = {
        revision: reviewRevision(projection) ?? "unknown",
        accepted: false,
        overrides: {},
      } satisfies ReviewResolution;
    } else if (projection.reviewResolution) {
      review = {
        revision: projection.reviewResolution.revision,
        accepted: true,
        overrides: projection.reviewResolution.overrides,
      } satisfies ReviewResolution;
    }
    tasks[projection.id] = {
      logicalId: projection.id,
      kind: projection.kind,
      title: projection.title,
      ...(projection.logicalKey ? { logicalKey: projection.logicalKey } : {}),
      aliases,
      sourceIds: [...projection.sourceIds],
      sourceProposal,
      lastWritten,
      ...(Object.keys(protectedFields).length > 0 ? { protectedFields } : {}),
      ...(review ? { review } : {}),
    };
  }
  return { version: 1, tasks };
}

function own<T extends object, K extends PropertyKey>(value: T, key: K): boolean {
  return Object.hasOwn(value, key);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key);
}

function compatibleLogicalKey(candidate: string | undefined, stored: string | undefined) {
  if (candidate === undefined || stored === undefined) return candidate === undefined;
  return candidate === stored;
}
