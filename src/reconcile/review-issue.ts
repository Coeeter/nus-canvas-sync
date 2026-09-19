import type { TaskConflictIssue } from "../domain/task";
import { normalizeDateValue } from "./values";

export interface ReviewIssueFacts {
  availableFrom?: unknown;
  dueAt?: unknown;
  eventEndsAt?: unknown;
}

export function deriveReviewIssue(reason: string, facts: ReviewIssueFacts = {}): TaskConflictIssue {
  const normalized = normalizeIssueText(reason);
  const values = [
    facts.availableFrom,
    facts.dueAt,
    facts.eventEndsAt,
    ...extractDateMentions(reason),
  ]
    .filter((value) => value !== undefined)
    .map(normalizeIssueValue)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const classTimeMention = /\b(?:class time|meeting schedule|tutorial meeting)\b/.test(normalized);
  if (
    classTimeMention &&
    (/\b(?:not|missing|absent|unspecified|unavailable)\b/.test(normalized) ||
      /\bdoes not specify\b/.test(normalized))
  ) {
    return { kind: "missing-class-time", field: "eventEndsAt", values };
  }
  if (classTimeMention) {
    return { kind: "conflicting-class-time", field: "eventEndsAt", values };
  }
  if (/\b(?:deadline|due date|official due)\b/.test(normalized)) {
    return { kind: "conflicting-deadline", field: "Official Due", values };
  }
  if (/\b(?:available|release|unlock)\b/.test(normalized)) {
    return { kind: "conflicting-release", field: "Available From", values };
  }
  if (/\b(?:low confidence|ambiguous|uncertain|informational)\b/.test(normalized)) {
    return { kind: "ambiguous-evidence", values };
  }
  return { kind: `legacy:${normalized}`, values };
}

/**
 * This is only the migration fallback for old cached candidates that have no
 * structured issue. New model output supplies issue values directly; it never
 * relies on this prose interpretation.
 */
function extractDateMentions(reason: string): Array<string> {
  const months = new Map(
    [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ].map((month, index) => [month, index + 1] as const),
  );
  const mentions: Array<string> = [];
  const pattern =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,?\s+(\d{4}))?/gi;
  for (const match of reason.matchAll(pattern)) {
    const month = months.get(match[1]!.toLowerCase());
    const day = Number(match[2]);
    if (!month || day < 1 || day > 31) continue;
    const monthText = String(month).padStart(2, "0");
    const dayText = String(day).padStart(2, "0");
    mentions.push(match[3] ? `${match[3]}-${monthText}-${dayText}` : `${monthText}-${dayText}`);
  }
  return mentions;
}

export function reviewIssueFingerprint(issue: TaskConflictIssue) {
  const fields = [...new Set(issue.fields ?? (issue.field ? [issue.field] : []))].sort();
  const values = new Map<string, unknown>();
  for (const value of issue.values ?? []) {
    const normalized = normalizeIssueValue(value);
    values.set(JSON.stringify(normalized), normalized);
  }
  return {
    kind: issue.kind,
    fields,
    values: [...values.values()].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    ),
  };
}

function normalizeIssueValue(value: unknown): unknown {
  if (isStructuredIssueValue(value)) {
    return {
      field: value.field,
      state: value.state,
      ...(value.value !== undefined ? { value: normalizeIssueValue(value.value) } : {}),
    };
  }
  if (typeof value !== "string") return value;
  const date = normalizeDateValue(value);
  return date === value ? normalizeIssueText(value) : date;
}

function isStructuredIssueValue(
  value: unknown,
): value is { field: string; state: string; value?: unknown; sourceId?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { field?: unknown }).field === "string" &&
    typeof (value as { state?: unknown }).state === "string"
  );
}

function normalizeIssueText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
