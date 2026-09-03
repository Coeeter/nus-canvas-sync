const ZERO_VALUE_SENTINEL = "0001-01-01T00:00:00Z";

/** Canvas/canvas-cli represent "unset" as either JSON `null` or a Go zero-value timestamp; both mean unset. */
export function normalizeDate(raw: string | null | undefined) {
  if (raw === null || raw === undefined || raw === ZERO_VALUE_SENTINEL) return null;
  return raw;
}
