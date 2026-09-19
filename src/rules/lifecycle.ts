import { COURSE_RULES } from "../../config/course-rules";
import type { TaskFact, TaskProjection } from "../domain/task";
import { parseReconciliationDate } from "../reconcile/values";

const TERMINAL = new Set(["Done", "Dropped"]);

export function projectTask(fact: TaskFact, now: Date): TaskProjection {
  const base = (state: TaskProjection["state"], reason: string | null): TaskProjection => ({
    ...fact,
    state,
    actionable: state === "ready",
    needsReview: state === "review",
    reason,
    memberSourceIds: [...fact.sourceIds].sort(),
  });

  if (TERMINAL.has(fact.userStatus ?? "")) {
    return base(fact.userStatus === "Done" ? "done" : "inactive", "Preserved user choice");
  }
  if (fact.completed) return base("done", "Authoritative completion evidence");
  if (fact.conflict) return base("review", fact.conflict.reason);
  if (fact.kind === "optional") return base("inactive", "Optional material is opt-in");
  if (fact.kind === "physical-event") return base("inactive", "Attendance is calendar context");
  if (fact.kind === "e-lecture" && COURSE_RULES[fact.courseCode].lectureMode === "physical") {
    return base("inactive", "This course lecture is a physical event");
  }
  if (!fact.observed || (fact.kind === "assessment" && !fact.authoritativeAction)) {
    return base("expected", "Cadence or schedule is not release evidence");
  }
  const eventEndsAt = parseReconciliationDate(fact.eventEndsAt);
  if (fact.kind === "preparation" && eventEndsAt !== null && now.getTime() >= eventEndsAt) {
    return base("expired", "Preparation event has ended");
  }
  if (fact.blockedBy) return base("waiting", `Waiting on ${fact.blockedBy}`);
  if (fact.scheduled) return base("scheduled", "Assessed work takes place during class");
  const availableFrom = parseReconciliationDate(fact.availableFrom);
  if (availableFrom !== null && now.getTime() < availableFrom) {
    return base("locked", "Authoritative release time is in the future");
  }
  return base("ready", null);
}

export function cs2030sExerciseCompleted(latestCommitMessage: string | null | undefined) {
  return latestCommitMessage === "Submit";
}
