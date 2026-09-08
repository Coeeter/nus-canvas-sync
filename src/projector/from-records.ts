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
          lectureItems.some((item) => item.lockedForUser !== true),
        availableFrom: stringOrNull(record.fields.unlockAt),
        week,
      });
    }
  }
  facts.push(...courseSpecificFacts(records));
  return facts;
}

function courseSpecificFacts(records: ReadonlyArray<NormalizedRecord>): Array<TaskFact> {
  return [
    ...cs2030sProblemSetFacts(records),
    ...ma1301PreparationFacts(records),
    ...gea1000KnownFacts(records),
    ...gess1001KnownFacts(records),
  ];
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
          week: problemSet + 2,
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
        },
      ];
    });
}

function gea1000KnownFacts(records: ReadonlyArray<NormalizedRecord>): Array<TaskFact> {
  const facts: Array<TaskFact> = [];
  const tutorial = findAnnouncement(records, "GEA1000", /^Tutorial 2$/i);
  if (tutorial) {
    facts.push({
      id: tutorial.id,
      courseCode: tutorial.courseCode,
      kind: "preparation",
      title: "Prepare GEA1000 Tutorial 2 questions",
      sourceIds: [tutorial.id],
      sourceUrl: tutorial.sourceUrl,
      observed: true,
      authoritativeAction: true,
      availableFrom: stringOrNull(tutorial.fields.postedAt),
      eventEndsAt: "2026-09-09T04:00:00.000Z",
      workMode: "Before class",
    });
  }

  const video = findAnnouncement(records, "GEA1000", /^Video Assignment$/i);
  if (video) {
    const item = findModuleItem(records, "GEA1000", /video assignment/i);
    facts.push({
      id: video.id,
      courseCode: video.courseCode,
      kind: "assessment",
      title: "Create GEA1000 group video assignment",
      sourceIds: [video.id, ...(item ? [item.sourceId] : [])],
      sourceUrl: item?.sourceUrl ?? video.sourceUrl,
      observed: true,
      authoritativeAction: true,
      availableFrom: stringOrNull(video.fields.postedAt),
      dueAt: "2026-09-29",
      workMode: "Flexible",
    });
  }
  return facts;
}

function gess1001KnownFacts(records: ReadonlyArray<NormalizedRecord>): Array<TaskFact> {
  const facts: Array<TaskFact> = [];
  const tutorial = findAnnouncement(records, "GESS1001", /^Tutorial 2 Instructions/i);
  if (tutorial) {
    const item = findModuleItem(records, "GESS1001", /\[Tut 2\].*Multiple Interpretations/i);
    facts.push({
      id: tutorial.id,
      courseCode: tutorial.courseCode,
      kind: "preparation",
      title: "Prepare GESS1001 Tutorial 2 — Long Island stakeholder debate",
      sourceIds: [tutorial.id, ...(item ? [item.sourceId] : [])],
      sourceUrl: item?.sourceUrl ?? tutorial.sourceUrl,
      observed: true,
      authoritativeAction: true,
      availableFrom: stringOrNull(tutorial.fields.postedAt),
      eventEndsAt: "2026-09-07T10:00:00.000Z",
      workMode: "Before class",
    });
  }

  const announcement = findAnnouncement(records, "GESS1001", /^Assignment instructions/i);
  if (!announcement) return facts;
  const deadlineClarification = findAnnouncement(
    records,
    "GESS1001",
    /^Clarification on Individual Assignment Deadline/i,
  );
  const group = findModuleItem(records, "GESS1001", /Group Assignment.*Heritage and Tourism/i);
  const individual = findModuleItem(records, "GESS1001", /Individual Assignment.*Migration/i);
  facts.push({
    id: announcement.id,
    courseCode: announcement.courseCode,
    kind: "assessment",
    title: "Create GESS1001 group heritage/tourism landscape project",
    sourceIds: [announcement.id, ...(group ? [group.sourceId] : [])],
    sourceUrl: group?.sourceUrl ?? announcement.sourceUrl,
    observed: true,
    authoritativeAction: true,
    availableFrom: stringOrNull(announcement.fields.postedAt),
    dueAt: "2026-10-16T04:00:00.000Z",
    workMode: "Flexible",
  });
  facts.push({
    id: `${announcement.id}:individual-assignment`,
    courseCode: announcement.courseCode,
    kind: "assessment",
    title: "Write GESS1001 individual migrant landscapes article",
    sourceIds: [
      announcement.id,
      ...(deadlineClarification ? [deadlineClarification.id] : []),
      ...(individual ? [individual.sourceId] : []),
    ],
    sourceUrl: individual?.sourceUrl ?? announcement.sourceUrl,
    observed: true,
    authoritativeAction: true,
    availableFrom: stringOrNull(announcement.fields.postedAt),
    ...(deadlineClarification ? { dueAt: "2026-10-23T04:00:00.000Z" } : {}),
    workMode: "Flexible",
    ...(!deadlineClarification
      ? {
          conflict: {
            reason:
              "Assignment brief says 2026-09-18 12:00 SGT, while the live syllabus says 2026-10-23 12:00 SGT",
            sources: [announcement.id, ...(individual ? [individual.sourceId] : [])],
          },
        }
      : {}),
  });
  return facts;
}

function findAnnouncement(
  records: ReadonlyArray<NormalizedRecord>,
  courseCode: NormalizedRecord["courseCode"],
  title: RegExp,
) {
  return records.find(
    (record) =>
      record.courseCode === courseCode &&
      record.kind === "announcement" &&
      title.test(String(record.fields.title ?? "")),
  );
}

function findModuleItem(
  records: ReadonlyArray<NormalizedRecord>,
  courseCode: NormalizedRecord["courseCode"],
  title: RegExp,
) {
  for (const record of records) {
    if (record.courseCode !== courseCode || record.kind !== "module") continue;
    const items = Array.isArray(record.fields.items) ? record.fields.items : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const fields = item as Record<string, unknown>;
      if (!title.test(String(fields.title ?? ""))) continue;
      return {
        sourceId: `${record.id}:item:${String(fields.id)}`,
        sourceUrl: typeof fields.htmlUrl === "string" ? fields.htmlUrl : record.sourceUrl,
      };
    }
  }
  return null;
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

  const exercise = record.courseCode === "CS2030S" ? title.match(/^ex(\d+)$/i) : null;
  if (exercise) {
    const number = exercise[1]!;
    const skeleton = githubRepos.find((repo) => repo.id.endsWith(`:ex${number}-skeleton`));
    const personal = githubRepos.find((repo) => repo.id.includes(`:exercises-ex${number}-`));
    const repoName = personal?.id.split(":github-repo:")[1];
    const commits = githubCommits
      .filter((commit) => commit.fields.repoName === repoName)
      .sort((left, right) =>
        String(right.fields.authorDate ?? "").localeCompare(String(left.fields.authorDate ?? "")),
      );
    authoritativeAction = skeleton !== undefined;
    completed ||= commits[0]?.fields.message === "Submit";
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
      : PHYSICAL.test(title)
        ? "physical-event"
        : "assessment",
    title,
    sourceIds,
    sourceUrl: record.sourceUrl,
    observed: true,
    authoritativeAction,
    availableFrom: stringOrNull(record.fields.unlockAt),
    dueAt: stringOrNull(record.fields.dueAt),
    completed,
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
