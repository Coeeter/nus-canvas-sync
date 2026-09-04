import type { CandidateEnvelope } from "./types";

export function mergeCandidateEnvelopes(
  previous: CandidateEnvelope,
  fresh: CandidateEnvelope,
  affectedSourceIds: ReadonlySet<string>,
): CandidateEnvelope {
  return {
    candidates: [
      ...previous.candidates.filter((candidate) =>
        candidate.sourceIds.every((sourceId) => !affectedSourceIds.has(sourceId)),
      ),
      ...fresh.candidates,
    ],
  };
}
