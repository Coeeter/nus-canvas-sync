import type { TaskFact, TaskProjection, UserStatus } from "../domain/task";
import { projectTask } from "../rules/lifecycle";

export function resolveReviewedCandidate(
  fact: TaskFact,
  current: { needsReview: boolean; status: UserStatus },
  now: Date,
): TaskProjection | null {
  if (current.status === "Dropped") return null;
  const projected = projectTask({ ...fact, userStatus: current.status }, now);
  if (!current.needsReview && projected.state === "review") {
    return { ...projected, reason: `Review cannot be accepted yet: ${projected.reason}` };
  }
  return projected;
}
