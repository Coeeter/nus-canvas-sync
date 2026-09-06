import { createHash } from "node:crypto";
import type { TaskFact } from "../domain/task";
import { TaskAffectingFailureError } from "../errors";
import type { CourseCandidate } from "./types";

export function candidateIdentity(candidate: CourseCandidate): string {
  if (candidate.identity) return candidate.identity;
  const key = JSON.stringify(
    candidate.actionKey
      ? { kind: candidate.kind, action: candidate.actionKey }
      : {
          sources: candidate.sourceIds.slice().sort(),
          kind: candidate.kind,
          title: candidate.title.trim().toLowerCase().replace(/\s+/g, " "),
        },
  );
  return `candidate:${candidate.courseCode}:${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
}

export function assertUniqueCandidateIdentities(candidates: ReadonlyArray<CourseCandidate>) {
  const identities = new Set<string>();
  for (const candidate of candidates) {
    const identity = candidateIdentity(candidate);
    if (identities.has(identity))
      throw new TaskAffectingFailureError({
        command: "validate candidate identities",
        message: `duplicate candidate action identity: ${identity}; combine evidence for the same action or use distinct actionKeys for distinct work`,
      });
    identities.add(identity);
  }
}

export function candidateToFact(candidate: CourseCandidate): TaskFact {
  const dedicated = candidate.sourceIds.some((id) => /:(assignment|quiz):/.test(id));
  // A model date is not proof that a standalone assessment was released.
  const unverified =
    candidate.kind === "assessment" && (!dedicated || candidate.relationship === "action");
  const unsafe = candidate.confidence < 0.85 || Boolean(candidate.ambiguity) || unverified;
  return {
    id: candidateIdentity(candidate),
    courseCode: candidate.courseCode,
    kind: candidate.kind,
    title: candidate.title,
    sourceIds: candidate.sourceIds,
    observed: true,
    authoritativeAction: dedicated || candidate.kind !== "assessment",
    availableFrom: candidate.availableFrom ?? null,
    dueAt: candidate.dueAt ?? null,
    eventEndsAt: candidate.eventEndsAt ?? null,
    instructions: `${candidate.requiredAction}\n\nEvidence: ${candidate.evidence}`,
    ...(unsafe
      ? {
          conflict: {
            reason:
              candidate.ambiguity ??
              (unverified
                ? "Confirm this source-backed assessment and its dates"
                : "Low-confidence interpretation requires review"),
            sources: candidate.sourceIds,
          },
        }
      : {}),
  };
}

export function mergeCandidateFacts(
  deterministic: ReadonlyArray<TaskFact>,
  candidates: ReadonlyArray<CourseCandidate>,
): Array<TaskFact> {
  // Fresh output can also collide with retained candidates or migrated identities.
  assertUniqueCandidateIdentities(candidates);
  const facts = deterministic.map((fact) => ({ ...fact, sourceIds: [...fact.sourceIds] }));
  for (const candidate of candidates) {
    const proposed = candidateToFact(candidate);
    const overlaps = deterministic.filter((fact) =>
      fact.sourceIds.some((id) =>
        candidate.sourceIds.some((source) => id === source || id.startsWith(`${source}:item:`)),
      ),
    );
    if (candidate.kind === "e-lecture" && overlaps.some((fact) => fact.kind === "e-lecture"))
      continue;
    // Shared documents are provenance, not action identity. Only a dedicated
    // assessment or a matching deterministic preparation can absorb enrichment.
    const sameMaPreparation =
      candidate.courseCode === "MA1301" &&
      candidate.kind === "preparation" &&
      overlaps.some((fact) => fact.kind === "preparation" && candidate.sourceIds.includes(fact.id));
    const matches =
      candidate.relationship === "action" && !sameMaPreparation
        ? []
        : overlaps.filter(
            (fact) =>
              fact.kind === candidate.kind &&
              ((fact.kind === "assessment" &&
                fact.sourceIds.some(
                  (id) => /:(assignment|quiz):/.test(id) && candidate.sourceIds.includes(id),
                )) ||
                (fact.kind === "preparation" && fact.id === candidate.sourceIds[0])),
          );
    if (matches.length !== 1) {
      facts.push({ ...proposed, sourceIds: [...proposed.sourceIds] });
      continue;
    }
    const current = facts.find((fact) => fact.id === matches[0]!.id)!;
    const index = facts.indexOf(current);
    const dateConflict = ["dueAt", "availableFrom", "eventEndsAt"] as const;
    const disagreement = dateConflict.find(
      (key) =>
        proposed[key] != null &&
        (current[key] == null || Date.parse(current[key]!) !== Date.parse(proposed[key]!)),
    );
    facts[index] = {
      ...current,
      sourceIds: [...new Set([...current.sourceIds, ...candidate.sourceIds])],
      availableFrom: current.availableFrom ?? proposed.availableFrom ?? null,
      dueAt: current.dueAt ?? proposed.dueAt ?? null,
      eventEndsAt: current.eventEndsAt ?? proposed.eventEndsAt ?? null,
      instructions: [current.instructions, proposed.instructions].filter(Boolean).join("\n\n"),
      ...(disagreement || candidate.ambiguity
        ? {
            conflict: {
              reason:
                candidate.ambiguity ??
                `Confirm ${disagreement}: extracted date is missing from or conflicts with the API`,
              sources: [...current.sourceIds, ...candidate.sourceIds],
            },
          }
        : {}),
    };
  }
  return facts;
}
