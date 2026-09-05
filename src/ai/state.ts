import { candidateIdentity } from "./reduce";
import type { CandidateEnvelope, CourseCandidate } from "./types";

export function mergeCandidateEnvelopes(
  previous: CandidateEnvelope,
  fresh: CandidateEnvelope,
  affectedSourceIds: ReadonlySet<string>,
): CandidateEnvelope {
  const affected = previous.candidates.filter((candidate) =>
    candidate.sourceIds.some((id) => affectedSourceIds.has(id)),
  );
  const retained = previous.candidates.filter((candidate) => !affected.includes(candidate));
  const claimed = new Set<CourseCandidate>();
  const candidates = fresh.candidates.map((candidate) => {
    const matches = affected.filter(
      (old) =>
        !claimed.has(old) &&
        old.kind === candidate.kind &&
        old.sourceIds.some((id) => candidate.sourceIds.includes(id)) &&
        ((candidate.actionKey && candidate.actionKey === old.actionKey) ||
          old.requiredAction === candidate.requiredAction ||
          old.evidence === candidate.evidence),
    );
    const old = matches.length === 1 ? matches[0] : undefined;
    if (old) claimed.add(old);
    return { ...candidate, identity: old ? candidateIdentity(old) : candidateIdentity(candidate) };
  });
  return { candidates: [...retained, ...candidates] };
}
