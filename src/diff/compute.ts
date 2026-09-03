import type { NormalizedRecord } from "../normalize/types";

/**
 * DIF-002: compares by stable source identity and content hash only, so
 * transport-only changes, response reordering, and untouched records never
 * appear as a change.
 */
export function computeDiff(
  previous: ReadonlyArray<NormalizedRecord>,
  current: ReadonlyArray<NormalizedRecord>,
) {
  const previousById = new Map(previous.map((r) => [r.id, r]));
  const currentById = new Map(current.map((r) => [r.id, r]));

  const added: Array<NormalizedRecord> = [];
  const changed: Array<{ before: NormalizedRecord; after: NormalizedRecord }> = [];

  for (const [id, after] of currentById) {
    const before = previousById.get(id);
    if (!before) {
      added.push(after);
    } else if (before.contentHash !== after.contentHash) {
      changed.push({ before, after });
    }
  }

  const removed = previous.filter((r) => !currentById.has(r.id));

  return { added, changed, removed };
}
