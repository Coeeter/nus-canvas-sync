import type { TaskFact } from "../domain/task";
import type { CourseCandidate } from "./types";

export function candidateToFact(candidate: CourseCandidate): TaskFact {
  const dedicatedAssessment = candidate.sourceIds.some((id) => /:(assignment|quiz):/.test(id));
  const explicitAnnouncement =
    candidate.sourceIds.some((id) => /:announcement:/.test(id)) &&
    Boolean(candidate.availableFrom || candidate.dueAt);
  const unsafe = candidate.confidence < 0.85 || Boolean(candidate.ambiguity);
  const fact: TaskFact = {
    id: `candidate:${candidate.courseCode}:${candidate.sourceIds.slice().sort().join("+")}`,
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
