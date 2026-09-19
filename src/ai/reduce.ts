import { createHash } from "node:crypto";
import type { TaskFact } from "../domain/task";
import { deriveReviewIssue } from "../reconcile/review-issue";
import { isMachineDateValue } from "../reconcile/values";
import type { CandidateDateField, CanonicalTaskContext, CourseCandidate } from "./types";

export function candidateToFact(
  candidate: CourseCandidate,
  canonicalTasks: ReadonlyArray<CanonicalTaskContext> = [],
): TaskFact {
  const canonical = matchCanonicalTask(candidate, canonicalTasks);
  const dedicatedAssessment = candidate.sourceIds.some((id) => /:(assignment|quiz):/.test(id));
  const explicitAnnouncement =
    candidate.sourceIds.some((id) => /:announcement:/.test(id)) &&
    Boolean(candidate.availableFrom || candidate.dueAt);
  const unsafe =
    candidate.confidence < 0.85 || Boolean(candidate.ambiguity) || candidate.reviewIssue != null;
  // A title is useful only for the one-time conservative migration matcher
  // below. It is never a durable identity. New derived candidates must carry
  // a source-anchored logicalKey from the AI contract; canonical assessments
  // use their assignment/quiz identity.
  const logicalKey =
    canonical?.logicalKey ?? candidate.logicalKey ?? migrationLogicalKey(candidate);
  const legacyId = legacyCandidateIdentity(candidate);
  const fact: TaskFact = {
    id:
      canonical?.id ??
      (logicalKey
        ? `task:${candidate.courseCode}:${candidate.kind}:${createHash("sha256").update(`${candidate.courseCode}:${candidate.kind}:${logicalKey}`).digest("hex").slice(0, 20)}`
        : legacyId),
    ...(logicalKey ? { logicalKey } : {}),
    aliases: [legacyId, ...candidate.sourceIds],
    courseCode: candidate.courseCode,
    kind: candidate.kind,
    title: candidate.title,
    sourceIds: [...new Set([...(canonical?.sourceIds ?? []), ...candidate.sourceIds])],
    observed: true,
    authoritativeAction:
      candidate.kind !== "assessment" || dedicatedAssessment || explicitAnnouncement,
  };
  assignDateFact(fact, candidate, "availableFrom");
  assignDateFact(fact, candidate, "dueAt");
  assignDateFact(fact, candidate, "eventEndsAt");
  if (unsafe) {
    const reason = candidate.ambiguity ?? "Low-confidence interpretation requires review";
    const issueFields = [...new Set(candidate.reviewIssue?.fields ?? [])].sort();
    const [issueField] = issueFields;
    fact.conflict = {
      reason,
      sources: candidate.sourceIds,
      issue: candidate.reviewIssue
        ? {
            kind: candidate.reviewIssue.kind,
            ...(issueField ? { field: issueField } : {}),
            ...(issueFields.length > 0 ? { fields: issueFields } : {}),
            values: candidate.reviewIssue.values.map((value) => ({
              field: value.field,
              sourceId: value.sourceId,
              state: value.state,
              ...(value.value !== undefined ? { value: value.value } : {}),
            })),
          }
        : deriveReviewIssue(reason, fact),
    };
  }
  if (!canonical && !candidate.logicalKey && fact.authoritativeAction && !fact.conflict) {
    const reason = "Candidate has no durable logical key or validated canonical task match";
    fact.conflict = {
      reason,
      sources: candidate.sourceIds,
      issue: deriveReviewIssue(reason, fact),
    };
  }
  return fact;
}

function assignDateFact(fact: TaskFact, candidate: CourseCandidate, field: CandidateDateField) {
  const evidence = candidate.dateEvidence?.[field];
  if (evidence) {
    if (evidence.state === "value" && isMachineDateValue(evidence.value)) {
      fact[field] = evidence.value;
    } else if (evidence.state === "explicit-null") fact[field] = null;
    return;
  }
  // Legacy cached candidates had only nullable fields. A legacy null is
  // unknown, never an authoritative removal; a string remains a known value.
  const legacyValue = candidate[field];
  if (isMachineDateValue(legacyValue)) fact[field] = legacyValue;
}

/**
 * Only for migrating pre-repair cached candidates. New model output must use
 * its explicit source-anchored logicalKey. The stage vocabulary prevents a
 * shared announcement from merging proposal/report/presentation work.
 */
function migrationLogicalKey(candidate: CourseCandidate) {
  const anchor =
    [...candidate.sourceIds]
      .filter((sourceId) => /:(announcement|page|document|assignment|quiz):/.test(sourceId))
      .sort()[0] ?? candidate.sourceIds.slice().sort()[0];
  return `migration:${anchor ?? "unknown"}#${taskMatchKey(candidate.title, candidate.kind)}`;
}

/** The pre-repair hash remains an alias so old candidate rows can be migrated in place. */
export function legacyCandidateIdentity(candidate: CourseCandidate) {
  const semanticIdentity = JSON.stringify({
    sources: candidate.sourceIds.slice().sort(),
    kind: candidate.kind,
    title: candidate.title.trim().toLowerCase().replace(/\s+/g, " "),
  });
  return `candidate:${candidate.courseCode}:${createHash("sha256").update(semanticIdentity).digest("hex").slice(0, 20)}`;
}

/** Conservative matching key: action verbs and transport wording are not task identity. */
export function taskMatchKey(
  title: string,
  kind: CourseCandidate["kind"] | TaskFact["kind"] = "assessment",
) {
  const normalized = title
    .toLowerCase()
    .replace(/\battempt\s+(?=quiz\b)/g, " ")
    .replace(/\((?:chapter|week)\s*[^)]*\)/g, " ")
    .replace(/\b[a-z]{2,}\d{3,}[a-z0-9]*\b/g, " ")
    .replace(/\b(?:complete|submit|submission|online|create|prepare|review|watch|work on)\b/g, " ")
    .replace(/\b(?:the|a|an|this|task|assignment)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const quiz = normalized.match(/\bquiz\s*(\d+)\b/);
  if (quiz) {
    const variant = normalized
      .replace(quiz[0], " ")
      .match(/\b(?:practice|mock|sample|graded|attempt\s*\d*)\b(?:\s*\d+)?/i)?.[0]
      ?.replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return `${kind}:quiz:${quiz[1]}:${variant ?? "canonical"}`;
  }
  return `${kind}:${normalized
    .replace(/\bgroup\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()}`;
}

export function matchCanonicalTask(
  candidate: CourseCandidate,
  canonicalTasks: ReadonlyArray<CanonicalTaskContext>,
): CanonicalTaskContext | undefined {
  const sameKind = canonicalTasks.filter(
    (task) => task.courseCode === candidate.courseCode && task.kind === candidate.kind,
  );
  if (candidate.matchTaskId) {
    const explicit = sameKind.find(
      (task) =>
        task.id === candidate.matchTaskId ||
        task.sourceIds.includes(candidate.matchTaskId!) ||
        task.sourceIds.some((sourceId) => sourceId === candidate.matchTaskId),
    );
    if (
      explicit &&
      (explicit.sourceIds.some((sourceId) => candidate.sourceIds.includes(sourceId)) ||
        taskMatchKey(explicit.title, explicit.kind) ===
          taskMatchKey(candidate.title, candidate.kind))
    ) {
      return explicit;
    }
  }
  if (candidate.logicalKey) {
    const exactLogicalKey = sameKind.filter((task) => task.logicalKey === candidate.logicalKey);
    return exactLogicalKey.length === 1 ? exactLogicalKey[0] : undefined;
  }
  const sourceOverlap = sameKind.filter((task) =>
    task.sourceIds.some((sourceId) => candidate.sourceIds.includes(sourceId)),
  );
  if (sourceOverlap.length === 1) return sourceOverlap[0];
  const key = candidate.logicalKey ?? taskMatchKey(candidate.title, candidate.kind);
  const titleMatches = sameKind.filter(
    (task) => (task.logicalKey ?? taskMatchKey(task.title, task.kind)) === key,
  );
  return titleMatches.length === 1 ? titleMatches[0] : undefined;
}

export function mergeCandidateFacts(
  deterministic: ReadonlyArray<TaskFact>,
  candidates: ReadonlyArray<CourseCandidate>,
  canonicalTasks: ReadonlyArray<CanonicalTaskContext> = deterministic.map((fact) => ({
    id: fact.id,
    courseCode: fact.courseCode,
    kind: fact.kind,
    title: fact.title,
    sourceIds: fact.sourceIds,
    ...(fact.logicalKey ? { logicalKey: fact.logicalKey } : {}),
  })),
): Array<TaskFact> {
  const facts: Array<TaskFact> = deterministic.map((fact) => ({
    ...fact,
    sourceIds: [...fact.sourceIds],
    aliases: [...(fact.aliases ?? []), ...fact.sourceIds],
  }));
  const deterministicIds = new Set(deterministic.map((fact) => fact.id));
  for (const candidate of candidates) {
    const candidateFact = candidateToFact(candidate, canonicalTasks);
    const overlaps = facts.filter((fact) =>
      fact.sourceIds.some((sourceId) =>
        candidateFact.sourceIds.some(
          (candidateSourceId) =>
            sourceId === candidateSourceId || sourceId.startsWith(`${candidateSourceId}:item:`),
        ),
      ),
    );
    const exactIdentity = facts.find(
      (fact) => fact.id === candidateFact.id && fact.kind === candidateFact.kind,
    );
    const overlap = exactIdentity ?? (overlaps.length === 1 ? overlaps[0] : undefined);
    if (candidateFact.kind === "e-lecture" && overlaps.some((fact) => fact.kind === "e-lecture"))
      continue;
    if (!overlap) {
      facts.push(candidateFact);
      continue;
    }
    const current = overlap;
    if (
      current.kind !== candidateFact.kind &&
      deterministicIds.has(current.id) &&
      candidate.logicalKey === undefined
    ) {
      continue;
    }
    const canMerge =
      current.kind === candidateFact.kind &&
      (candidateFact.id === current.id ||
        (candidateFact.logicalKey !== undefined &&
          candidateFact.logicalKey === current.logicalKey));
    if (!canMerge) {
      facts.push(candidateFact);
      continue;
    }
    const index = facts.indexOf(current);
    facts[index] = {
      ...current,
      sourceIds: [...new Set([...current.sourceIds, ...candidate.sourceIds])],
      aliases: [...new Set([...(current.aliases ?? []), ...(candidateFact.aliases ?? [])])],
      ...mergeDateField(current, candidateFact, candidate, "availableFrom"),
      ...mergeDateField(current, candidateFact, candidate, "dueAt"),
      ...mergeDateField(current, candidateFact, candidate, "eventEndsAt"),
    };
  }
  return facts;
}

function mergeDateField(
  current: TaskFact,
  candidateFact: TaskFact,
  candidate: CourseCandidate,
  field: CandidateDateField,
) {
  const evidence = candidate.dateEvidence?.[field];
  if (evidence?.state === "explicit-null") return { [field]: null };
  return current[field] === undefined && candidateFact[field] !== undefined
    ? { [field]: candidateFact[field] }
    : {};
}
