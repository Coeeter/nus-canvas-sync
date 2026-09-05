import type { TaskFact } from "../domain/task";

const SEMESTER_WEEK_ONE_SGT = Date.parse("2026-08-10T00:00:00+08:00");
const WEEK_MILLIS = 7 * 24 * 60 * 60 * 1000;

export function applyCourseSchedule(facts: ReadonlyArray<TaskFact>): Array<TaskFact> {
  return facts.map((fact) => {
    if (fact.courseCode === "CS2030S" && fact.kind === "preparation" && fact.week) {
      const weekStart =
        SEMESTER_WEEK_ONE_SGT + (fact.week - 1 + (fact.week >= 7 ? 1 : 0)) * WEEK_MILLIS;
      const eventEndsAt = weekStart + (2 * 24 + 15) * 60 * 60 * 1000;
      return {
        ...fact,
        availableFrom: fact.availableFrom ?? new Date(eventEndsAt - WEEK_MILLIS).toISOString(),
        eventEndsAt: fact.eventEndsAt ?? new Date(eventEndsAt).toISOString(),
      };
    }
    if (fact.courseCode !== "MA1301" || fact.kind !== "preparation") return fact;
    const week = preparationWeek(fact);
    if (week === null) return fact;
    const weekStart = SEMESTER_WEEK_ONE_SGT + (week - 1 + (week >= 7 ? 1 : 0)) * WEEK_MILLIS;
    const availableFrom = new Date(weekStart - WEEK_MILLIS).toISOString();
    const eventEndsAt = new Date(weekStart + (4 * 24 + 12) * 60 * 60 * 1000).toISOString();
    return {
      ...fact,
      availableFrom: fact.availableFrom ?? availableFrom,
      eventEndsAt: fact.eventEndsAt ?? eventEndsAt,
    };
  });
}

function preparationWeek(fact: TaskFact) {
  for (const sourceId of fact.sourceIds) {
    const sourceWeek = sourceId.match(/:page:week-(\d+)$/i)?.[1];
    if (sourceWeek) return Number(sourceWeek);
  }
  const titleWeek = fact.title.match(/\bweek\s*(\d+)\b/i)?.[1];
  return titleWeek ? Number(titleWeek) : null;
}
