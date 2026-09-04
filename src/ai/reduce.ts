import { createHash } from "node:crypto";
import type { TaskFact } from "../domain/task";
import type { CourseCandidate } from "./types";

export function candidateToFact(candidate: CourseCandidate): TaskFact {
  const dedicatedAssessment = candidate.sourceIds.some((id) => /:(assignment|quiz):/.test(id));
  const explicitAnnouncement =
    candidate.sourceIds.some((id) => /:announcement:/.test(id)) &&
    Boolean(candidate.availableFrom || candidate.dueAt);
  const unsafe = candidate.confidence < 0.85 || Boolean(candidate.ambiguity);
  const semanticIdentity = JSON.stringify({
    sources: candidate.sourceIds.slice().sort(),
    kind: candidate.kind,
    title: candidate.title.trim().toLowerCase().replace(/\s+/g, " "),
  });
  const fact: TaskFact = {
    id: `candidate:${candidate.courseCode}:${createHash("sha256").update(semanticIdentity).digest("hex").slice(0, 20)}`,
    courseCode: candidate.courseCode,
    kind: candidate.kind,
    title: candidate.title,
    sourceIds: candidate.sourceIds,
    observed: true,
    authoritativeAction:
      candidate.kind !== "assessment" || dedicatedAssessment || explicitAnnouncement,
  };
  if (candidate.availableFrom !== undefined) fact.availableFrom = candidate.availableFrom;
  if (candidate.dueAt !== undefined) fact.dueAt = candidate.dueAt;
  if (candidate.eventEndsAt !== undefined) fact.eventEndsAt = candidate.eventEndsAt;
  if (unsafe) {
    fact.conflict = {
      reason: candidate.ambiguity ?? "Low-confidence interpretation requires review",
      sources: candidate.sourceIds,
    };
  }
  return fact;
}

export function mergeCandidateFacts(
  deterministic: ReadonlyArray<TaskFact>,
  candidates: ReadonlyArray<CourseCandidate>,
): Array<TaskFact> {
  const facts: Array<TaskFact> = deterministic.map((fact) => ({
    ...fact,
    sourceIds: [...fact.sourceIds],
  }));
  for (const candidate of candidates) {
    const candidateFact = candidateToFact(candidate);
    const overlaps = facts.filter((fact) =>
      fact.sourceIds.some((sourceId) =>
        candidate.sourceIds.some(
          (candidateSourceId) =>
            sourceId === candidateSourceId || sourceId.startsWith(`${candidateSourceId}:item:`),
        ),
      ),
    );
    if (overlaps.length > 1 || overlaps.some((fact) => fact.kind === "e-lecture")) continue;
    if (overlaps.length === 0) {
      facts.push(candidateFact);
      continue;
    }
    const current = overlaps[0]!;
    const index = facts.indexOf(current);
    facts[index] = {
      ...current,
      sourceIds: [...new Set([...current.sourceIds, ...candidate.sourceIds])],
      ...(current.availableFrom === undefined && candidateFact.availableFrom !== undefined
        ? { availableFrom: candidateFact.availableFrom }
        : {}),
      ...(current.dueAt === undefined && candidateFact.dueAt !== undefined
        ? { dueAt: candidateFact.dueAt }
        : {}),
      ...(current.eventEndsAt === undefined && candidateFact.eventEndsAt !== undefined
        ? { eventEndsAt: candidateFact.eventEndsAt }
        : {}),
    };
  }
  return facts;
}
