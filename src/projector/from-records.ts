import type { TaskFact } from "../domain/task";
import type { NormalizedRecord } from "../normalize/types";

const OPTIONAL =
  /(?:\boptional\b|\bpractice\b|\banonymous feedback\b|\breference\b|^information:|\bmock quiz\b|\bsample quiz\b)/i;
const PHYSICAL =
  /\b(sit[- ]?in lab|lecture attendance|tutorial attendance|recitation attendance)\b/i;

export function factsFromRecords(records: ReadonlyArray<NormalizedRecord>): Array<TaskFact> {
  const facts: Array<TaskFact> = [];
  const quizzes = new Map(
    records
      .filter((record) => record.kind === "quiz")
      .map((record) => [numericIdentity(record.id), record] as const)
      .filter((entry): entry is readonly [number, NormalizedRecord] => entry[0] !== null),
  );
  const consumedQuizzes = new Set<string>();
  const githubRepos = records.filter((record) => record.kind === "github-repo");
  const githubCommits = records.filter((record) => record.kind === "github-commit");

  for (const record of records.filter((record) => record.kind === "assignment")) {
    const quizId = typeof record.fields.quizId === "number" ? record.fields.quizId : null;
    const quiz = quizId === null ? undefined : quizzes.get(quizId);
    if (quiz) consumedQuizzes.add(quiz.id);
    facts.push(
      assessmentFact(record, quiz ? [record.id, quiz.id] : [record.id], githubRepos, githubCommits),
    );
  }

  for (const record of records.filter(
    (record) => record.kind === "quiz" && !consumedQuizzes.has(record.id),
  )) {
    facts.push(assessmentFact(record, [record.id], githubRepos, githubCommits));
  }

  for (const record of records) {
    if (
      record.kind === "module" &&
      (record.courseCode === "GEA1000" || record.courseCode === "GESS1001")
    ) {
      const week = parseWeek(String(record.fields.name ?? ""));
      if (week === null) continue;
      const items = Array.isArray(record.fields.items) ? record.fields.items : [];
      const lectureItems = items
        .filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object"),
        )
        .filter((item) => isLectureItem(record.courseCode, String(item.title ?? "")));
      if (lectureItems.length === 0) continue;
      const sourceIds = lectureItems.map((item) => `${record.id}:item:${String(item.id)}`);
      const first = lectureItems[0]!;
      facts.push({
        id: sourceIds[0]!,
        courseCode: record.courseCode,
        kind: "e-lecture",
        title: `Week ${week}`,
        sourceIds,
        sourceUrl: typeof first.htmlUrl === "string" ? first.htmlUrl : record.sourceUrl,
        observed:
          record.fields.state !== "locked" &&
          lectureItems.every((item) => item.lockedForUser !== true),
        availableFrom:
          [
            stringOrNull(record.fields.unlockAt),
            ...lectureItems.map((item) => stringOrNull(item.unlockAt)),
          ]
            .filter((date): date is string => date !== null)
            .sort()
            .at(-1) ?? null,
        published:
          record.fields.published !== false &&
          lectureItems.every((item) => item.published !== false),
        week,
      });
    }
  }
  facts.push(...courseSpecificFacts(records));
  return facts;
}

function courseSpecificFacts(records: ReadonlyArray<NormalizedRecord>): Array<TaskFact> {
  return [...cs2030sProblemSetFacts(records), ...ma1301PreparationFacts(records)];
}

function cs2030sProblemSetFacts(records: ReadonlyArray<NormalizedRecord>): Array<TaskFact> {
  return records
    .filter((record) => record.courseCode === "CS2030S" && record.kind === "document")
    .flatMap((record) => {
      const number = String(record.fields.displayName ?? "").match(/^ps-(\d+)\.pdf$/i)?.[1];
      if (number === undefined || Number(number) === 0) return [];
      const problemSet = Number(number);
      return [
        {
          id: record.id,
          courseCode: record.courseCode,
          kind: "preparation" as const,
          title: `Prepare CS2030S Problem Set ${problemSet} for recitation`,
          sourceIds: [record.id],
          sourceUrl: record.sourceUrl,
          observed: true,
          authoritativeAction: true,
          workMode: "Before class" as const,
          instructions: String(record.fields.text ?? ""),
          ...(problemSet <= 4
            ? { week: problemSet + 2 }
            : {
                conflict: {
                  reason: "Confirm the recitation date from the current course schedule",
                  sources: [record.id],
                },
              }),
        },
      ];
    });
}

function ma1301PreparationFacts(records: ReadonlyArray<NormalizedRecord>): Array<TaskFact> {
  return records
    .filter((record) => record.courseCode === "MA1301" && record.kind === "page")
    .flatMap((record) => {
      const week = parseWeek(String(record.fields.title ?? ""));
      const body = String(record.fields.body ?? "");
      if (week === null || !/in preparation for this week's classes/i.test(body)) return [];
      return [
        {
          id: record.id,
          courseCode: record.courseCode,
          kind: "preparation" as const,
          title: `MA1301 Week ${week} preparation`,
          sourceIds: [record.id],
          sourceUrl: record.sourceUrl,
          observed: true,
          authoritativeAction: true,
          workMode: "Before class" as const,
          week,
          instructions: body,
        },
      ];
    });
}

function assessmentFact(
  record: NormalizedRecord,
  sourceIds: Array<string>,
  githubRepos: ReadonlyArray<NormalizedRecord>,
  githubCommits: ReadonlyArray<NormalizedRecord>,
): TaskFact {
  const title = String(record.fields.name ?? record.fields.title ?? "Untitled assessment");
  const submission = record.fields.submission as
    | { workflowState?: string; submittedAt?: string | null; grade?: string | null }
    | null
    | undefined;
  let completed = Boolean(
    submission &&
      (submission.submittedAt ||
        submission.grade ||
        submission.workflowState === "submitted" ||
        submission.workflowState === "graded"),
  );
  let authoritativeAction = true;
  let inProgress = false;

  const exercise = record.courseCode === "CS2030S" ? title.match(/^ex(\d+)$/i) : null;
  if (exercise) {
    const number = exercise[1]!;
    const skeleton = githubRepos.find((repo) => repo.id.endsWith(`:ex${number}-skeleton`));
    const personal = githubRepos.find((repo) => repo.id.includes(`:exercises-ex${number}-`));
    const repoName = personal?.id.split(":github-repo:")[1];
    const commits = githubCommits.filter((commit) => commit.fields.repoName === repoName);
    authoritativeAction = skeleton !== undefined;
    completed = commits[0]?.fields.message === "Submit";
    inProgress = Boolean(
      commits[0] && !["Initial commit", "Submit"].includes(String(commits[0].fields.message)),
    );
    sourceIds.push(
      ...[skeleton, personal, ...commits]
        .filter((item) => item !== undefined)
        .map((item) => item.id),
    );
  }

  return {
    id: record.id,
    courseCode: record.courseCode,
    kind: OPTIONAL.test(title)
      ? "optional"
      : PHYSICAL.test(title) || (record.courseCode === "CS2030S" && /\blab\b/i.test(title))
        ? "physical-event"
        : "assessment",
    title,
    sourceIds,
    sourceUrl: record.sourceUrl,
    observed: true,
    authoritativeAction,
    availableFrom: exercise ? null : stringOrNull(record.fields.unlockAt),
    dueAt: stringOrNull(record.fields.dueAt),
    completed,
    inProgress,
    lockedForUser: !exercise && record.fields.lockedForUser === true,
    published: exercise ? true : record.fields.published !== false,
    lockAt: exercise ? null : stringOrNull(record.fields.lockAt),
    instructions: String(record.fields.description ?? ""),
    ...(isScheduledInClassAssessment(record.courseCode, title)
      ? { scheduled: true, workMode: "During class" as const }
      : {}),
  };
}

function isScheduledInClassAssessment(courseCode: NormalizedRecord["courseCode"], title: string) {
  if (courseCode === "CS2030S") {
    return /^(?:Quiz \(Attempt \d+\)|Midterm|Final|PE\d+)$/i.test(title);
  }
  return courseCode === "MA1301" && /^(?:Quiz \d+|MA1301 In-class Quiz)/i.test(title);
}

function numericIdentity(identity: string): number | null {
  const value = identity.match(/:(\d+)$/)?.[1];
  return value === undefined ? null : Number(value);
}

function isLectureItem(courseCode: NormalizedRecord["courseCode"], title: string) {
  return courseCode === "GEA1000"
    ? /\b(?:content|technical) videos\b/i.test(title)
    : /\bweek\s*\d+\s+(?:lecture\s+)?content\b/i.test(title) || /\brecorded lecture\b/i.test(title);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseWeek(value: string): number | null {
  const match = value.match(/\bweek\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}
