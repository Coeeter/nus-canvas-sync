const ZERO_VALUE_SENTINEL = "0001-01-01T00:00:00Z";

/** Canvas/canvas-cli represent "unset" as either JSON `null` or a Go zero-value timestamp; both mean unset. */
export function normalizeDate(raw: string | null | undefined) {
  if (raw === null || raw === undefined || raw === ZERO_VALUE_SENTINEL) return null;
  return raw;
}

/** Canvas date-only values denote Singapore calendar dates, never UTC midnight. */
export function sourceDate(value: string): Date {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value;
  return new Date(normalized);
}

export function validSourceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))
    return false;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendar = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month! - 1 &&
    calendar.getUTCDate() === day &&
    Number.isFinite(sourceDate(value).getTime())
  );
}
