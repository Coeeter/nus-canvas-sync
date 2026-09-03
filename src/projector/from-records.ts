import type { TaskFact } from "../domain/task";
import type { NormalizedRecord } from "../normalize/types";

const OPTIONAL = /\b(optional|practice diagnostic|anonymous feedback|reference)\b/i;
const PHYSICAL =
  /\b(sit[- ]?in lab|lecture attendance|tutorial attendance|recitation attendance)\b/i;

export function factsFromRecords(records: ReadonlyArray<NormalizedRecord>): Array<TaskFact> {
  const facts: Array<TaskFact> = [];
  for (const record of records) {
    if (record.kind === "assignment" || record.kind === "quiz") {
      const title = String(record.fields.name ?? record.fields.title ?? "Untitled assessment");
      const submission = record.fields.submission as
        | { workflowState?: string; submittedAt?: string | null; grade?: string | null }
        | null
        | undefined;
      const completed = Boolean(
        submission &&
          (submission.submittedAt ||
            submission.grade ||
            submission.workflowState === "submitted" ||
            submission.workflowState === "graded"),
      );
      facts.push({
        id: record.id,
        courseCode: record.courseCode,
        kind: OPTIONAL.test(title)
          ? "optional"
          : PHYSICAL.test(title)
            ? "physical-event"
            : "assessment",
        title,
        sourceIds: [record.id],
        sourceUrl: record.sourceUrl,
        observed: true,
        authoritativeAction: true,
        availableFrom: stringOrNull(record.fields.unlockAt),
        dueAt: stringOrNull(record.fields.dueAt),
        completed,
      });
    }
    if (
      record.kind === "module" &&
      (record.courseCode === "GEA1000" || record.courseCode === "GESS1001")
    ) {
      const items = Array.isArray(record.fields.items) ? record.fields.items : [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const fields = item as Record<string, unknown>;
        const title = String(fields.title ?? "");
        if (!/\b(e-?lecture|lecture (video|part)|recorded lecture)\b/i.test(title)) continue;
        const week = parseWeek(`${record.fields.name ?? ""} ${title}`);
        facts.push({
          id: `${record.id}:item:${String(fields.id)}`,
          courseCode: record.courseCode,
          kind: "e-lecture",
          title,
          sourceIds: [record.id],
          sourceUrl: typeof fields.htmlUrl === "string" ? fields.htmlUrl : record.sourceUrl,
          observed: fields.published !== false,
          availableFrom: stringOrNull(fields.unlockAt) ?? stringOrNull(record.fields.unlockAt),
          ...(week === null ? {} : { week }),
        });
      }
    }
  }
  return facts;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseWeek(value: string): number | null {
  const match = value.match(/\bweek\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}
