import { TaskAffectingFailureError } from "../errors";
import type { CandidateEnvelope } from "./types";

const COURSE_CODES = new Set(["CS2030S", "GEA1000", "GESS1001", "IS1128", "MA1301"]);
const KINDS = new Set(["assessment", "preparation", "e-lecture", "physical-event", "optional"]);

export function validateCandidates(
  raw: unknown,
  courseCode: string,
  allowedSourceIds: ReadonlySet<string>,
) {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as CandidateEnvelope).candidates)) {
    throw invalid("output is not a candidate envelope");
  }
  const envelope = raw as CandidateEnvelope;
  for (const candidate of envelope.candidates) {
    if (!COURSE_CODES.has(candidate.courseCode) || candidate.courseCode !== courseCode) {
      throw invalid("candidate crossed the one-course boundary");
    }
    if (!KINDS.has(candidate.kind) || !candidate.title || !candidate.evidence) {
      throw invalid("candidate is missing required evidence or fields");
    }
    if (!Array.isArray(candidate.sourceIds) || candidate.sourceIds.length === 0) {
      throw invalid("candidate has no provenance");
    }
    if (candidate.sourceIds.some((id) => !allowedSourceIds.has(id))) {
      throw invalid("candidate cites an unavailable source identity");
    }
    if (
      typeof candidate.confidence !== "number" ||
      candidate.confidence < 0 ||
      candidate.confidence > 1
    ) {
      throw invalid("candidate confidence is outside 0..1");
    }
  }
  return envelope;
}

function invalid(message: string) {
  return new TaskAffectingFailureError({ command: "validate Codex output", message });
}
