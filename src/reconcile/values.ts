const DATE_FIELDS = new Set([
  "Available From",
  "Official Due",
  "Last Synced",
  "Planned",
  "Start By",
]);

export function sameReconciliationValue(name: string, left: unknown, right: unknown) {
  if (DATE_FIELDS.has(name)) return normalizeDateValue(left) === normalizeDateValue(right);
  return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeDateValue(value: unknown) {
  if (typeof value !== "string") return value;
  if (isDateOnly(value)) return value;
  const parsed = parseStrictMachineDate(value);
  return parsed === null ? value : new Date(parsed).toISOString();
}

/** Machine-owned dates must be ISO calendar dates or timestamps with a timezone. */
export function isMachineDateValue(value: unknown): value is string {
  return typeof value === "string" && (isDateOnly(value) || parseStrictMachineDate(value) !== null);
}

export function isDateBefore(left: unknown, right: unknown) {
  const leftTime = parseReconciliationDate(left);
  const rightTime = parseReconciliationDate(right);
  return leftTime !== null && rightTime !== null && leftTime < rightTime;
}

/** Parse date-only values at the start of the Asia/Singapore calendar day. */
export function parseReconciliationDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  if (isDateOnly(value)) return Date.parse(`${value}T00:00:00+08:00`);
  return parseStrictMachineDate(value);
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && parseCalendarDate(value) !== null;
}

function parseStrictMachineDate(value: string): number | null {
  const timestamp = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!timestamp) return null;
  const [, year, month, day, hour, minute, second = "0", _fraction] = timestamp;
  const offset = timestamp[8];
  if (!offset) return null;
  if (
    parseCalendarDate(`${year}-${month}-${day}`) === null ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59))
  ) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseCalendarDate(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay ? Date.UTC(year, month - 1, day) : null;
}
