import type { NormalizedRecord } from "../normalize/types";

export interface SemanticDiff {
  added: Array<NormalizedRecord>;
  changed: Array<{ before: NormalizedRecord; after: NormalizedRecord }>;
  removed: Array<NormalizedRecord>;
}

export const EMPTY_DIFF: SemanticDiff = { added: [], changed: [], removed: [] };

export function isEmptyDiff(diff: SemanticDiff) {
  return diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0;
}
