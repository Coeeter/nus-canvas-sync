import { DateTime, Effect, Result } from "effect";
import type { CanvasFile, CanvasPlannerItem } from "../../schemas/canvas.schema";
import type { GithubCommit, GithubRepo } from "../../schemas/github.schema";
import { COURSES, type Course, type CourseCode } from "../config/courses";
import { computeDiff } from "../diff/compute";
import { EMPTY_DIFF, type SemanticDiff } from "../diff/types";
import { type CourseEndpointResults, normalizeCourseRecords } from "../normalize/course";
import {
  normalizeDocument,
  normalizeGithubCommit,
  normalizeGithubRepo,
  normalizePlannerItem,
} from "../normalize/records";
import type { NormalizedRecord } from "../normalize/types";
import { readBaseline } from "../state/baseline-store";
import { withRunLock } from "../state/lock";
import { type CourseManifestEntry, type RunManifest, summarizeResult } from "../state/manifest";
import { writeSnapshot } from "../state/snapshot-store";
import { CanvasClient } from "./canvas";
import { courseCoverageSucceeded } from "./coverage";
import {
  downloadAndExtract,
  hasDownloadableUrl,
  isExtractableDocument,
  referencedByForFile,
  selectRelevantFiles,
} from "./documents";
import { filterRelevantRepos, GithubClient } from "./github";
import type { EndpointResult } from "./types";

export interface CollectionResult {
  runId: string;
  manifest: RunManifest;
  snapshotDir: string;
  records: Partial<Record<CourseCode, Array<NormalizedRecord>>>;
  diffs: Partial<Record<CourseCode, SemanticDiff>>;
}

/** Planner covers the full declared semester window (README/sync.sh precedent). */
const PLANNER_WINDOW = { startDate: "2026-07-19", endDate: "2027-01-10" };
const PAGE_FETCH_CONCURRENCY = 4;
const COMMIT_FETCH_CONCURRENCY = 4;
const COURSE_FETCH_CONCURRENCY = 2;
const ENDPOINT_FETCH_CONCURRENCY = 4;

export const collect = Effect.fn("collect")(function* (dataDir: string) {
  return yield* withRunLock(dataDir, runCollection(dataDir));
});

export const collectUnlocked = Effect.fn("collectUnlocked")(function* (dataDir: string) {
  return yield* runCollection(dataDir);
});

interface CourseOutcome {
  course: Course;
  normalized: Array<NormalizedRecord>;
  diff: SemanticDiff;
  entry: CourseManifestEntry;
}

const runCollection = Effect.fn("runCollection")(function* (dataDir: string) {
  const canvas = yield* CanvasClient;
  const github = yield* GithubClient;
  const now = yield* DateTime.now;

  const startedAt = DateTime.formatIso(now);
  const runId = startedAt.replace(/[-:]/g, "").replace(".", "");

  const viewerLoginResult = yield* Effect.result(github.viewerLogin);
  const reposResult = yield* Effect.result(github.repositories);

  const login = Result.isSuccess(viewerLoginResult)
    ? viewerLoginResult.success.toLowerCase()
    : null;
  const relevantRepos =
    Result.isSuccess(reposResult) && login !== null
      ? filterRelevantRepos(reposResult.success, login)
      : [];
  const exerciseRepoNames =
    login !== null
      ? github.relevantExerciseRepos(
          login,
          relevantRepos.map((repo) => repo.name),
        )
      : [];

  const commitResults = yield* Effect.all(
    exerciseRepoNames.map((repoName) =>
      Effect.result(github.commits(repoName)).pipe(
        Effect.map((result) => [repoName, result] as const),
      ),
    ),
    { concurrency: COMMIT_FETCH_CONCURRENCY },
  );

  const plannerResult = yield* Effect.result(canvas.plannerItems(COURSES, PLANNER_WINDOW));
  const plannerByCourse = groupPlannerByCourse(plannerResult);
  const githubHealthy =
    Result.isSuccess(viewerLoginResult) &&
    Result.isSuccess(reposResult) &&
    commitResults.every(([, result]) => Result.isSuccess(result));

  const courseOutcomes = yield* Effect.all(
    COURSES.map((course) =>
      collectCourse(course, {
        canvas,
        dataDir,
        plannerRecords: plannerByCourse.get(course.id) ?? [],
        githubRepos: course.code === "CS2030S" ? relevantRepos : [],
        githubCommits: course.code === "CS2030S" ? commitResults : [],
        upstreamHealthy:
          Result.isSuccess(plannerResult) && (course.code !== "CS2030S" || githubHealthy),
      }),
    ),
    { concurrency: COURSE_FETCH_CONCURRENCY },
  );

  const records: Partial<Record<CourseCode, Array<NormalizedRecord>>> = {};
  const diffs: Partial<Record<CourseCode, SemanticDiff>> = {};
  const courseEntries: Array<CourseManifestEntry> = [];
  for (const outcome of courseOutcomes) {
    records[outcome.course.code] = outcome.normalized;
    diffs[outcome.course.code] = outcome.diff;
    courseEntries.push(outcome.entry);
  }

  const manifest: RunManifest = {
    runId,
    startedAt,
    finishedAt: DateTime.formatIso(yield* DateTime.now),
    courses: courseEntries,
    planner: summarizeResult(plannerResult),
    github: {
      viewerLogin: summarizeResult(viewerLoginResult),
      repositories: summarizeResult(reposResult),
      ...Object.fromEntries(
        commitResults.map(([repo, result]) => [`commits:${repo}`, summarizeResult(result)]),
      ),
    },
  };

  const dir = yield* writeSnapshot(dataDir, { timestamp: runId, manifest, courses: records });

  return { runId, manifest, snapshotDir: dir, records, diffs } satisfies CollectionResult;
});

function groupPlannerByCourse(
  plannerResult: EndpointResult<ReadonlyArray<CanvasPlannerItem>>,
): Map<number, Array<NormalizedRecord>> {
  const byCourse = new Map<number, Array<NormalizedRecord>>();
  if (Result.isFailure(plannerResult)) return byCourse;
  for (const item of plannerResult.success) {
    const course = COURSES.find((c) => c.id === item.course_id);
    if (!course) continue;
    const list = byCourse.get(course.id) ?? [];
    list.push(normalizePlannerItem(course, item));
    byCourse.set(course.id, list);
  }
  return byCourse;
}

interface CollectCourseDeps {
  canvas: CanvasClient["Service"];
  dataDir: string;
  plannerRecords: Array<NormalizedRecord>;
  githubRepos: ReadonlyArray<GithubRepo>;
  githubCommits: ReadonlyArray<readonly [string, EndpointResult<ReadonlyArray<GithubCommit>>]>;
  upstreamHealthy: boolean;
}

const collectCourse = Effect.fn("collectCourse")(function* (
  course: Course,
  deps: CollectCourseDeps,
) {
  const { canvas, dataDir, plannerRecords, githubRepos, githubCommits, upstreamHealthy } = deps;

  const [assignments, quizzes, announcements, files, modules, frontPage, pagesIndex] =
    yield* Effect.all(
      [
        Effect.result(canvas.assignments(course)),
        Effect.result(canvas.quizzes(course)),
        Effect.result(canvas.announcements(course)),
        Effect.result(canvas.files(course)),
        Effect.result(canvas.modules(course)),
        Effect.result(canvas.frontPage(course)),
        Effect.result(canvas.pagesIndex(course)),
      ],
      { concurrency: ENDPOINT_FETCH_CONCURRENCY },
    );

  const pageUrls = Result.isSuccess(pagesIndex) ? pagesIndex.success.map((page) => page.url) : [];
  const pageBodies = yield* Effect.all(
    pageUrls.map((url) => Effect.result(canvas.pageBody(course, url))),
    { concurrency: PAGE_FETCH_CONCURRENCY },
  );

  const endpoints: CourseEndpointResults = {
    assignments,
    quizzes,
    announcements,
    files,
    modules,
    frontPage,
    pageBodies,
  };

  const sourceRecords = [...normalizeCourseRecords(course, endpoints), ...plannerRecords];
  sourceRecords.push(...githubRepos.map((repo) => normalizeGithubRepo(course, repo)));
  for (const [repoName, result] of githubCommits) {
    if (Result.isSuccess(result)) {
      sourceRecords.push(
        ...result.success.map((commit) => normalizeGithubCommit(course, repoName, commit)),
      );
    }
  }

  const baseline = yield* readBaseline(dataDir, course.code);
  const baselineSources = baseline.filter((record) => record.kind !== "document");
  const sourceDiff = computeDiff(baselineSources, sourceRecords);
  const changedRecords = [...sourceDiff.added, ...sourceDiff.changed.map((change) => change.after)];
  const documents = yield* collectDocuments(
    course,
    dataDir,
    files,
    sourceRecords,
    changedRecords,
    baseline,
  );
  const normalized = [...sourceRecords, ...documents.records];
  const endpointSummaries = {
    assignments: summarizeResult(assignments),
    quizzes: summarizeResult(quizzes),
    announcements: summarizeResult(announcements),
    files: summarizeResult(files),
    modules: summarizeResult(modules),
    frontPage: summarizeResult(frontPage),
    pages: summarizeResult(pagesIndex),
    ...Object.fromEntries(
      pageUrls.map((url, index) => [`page:${url}`, summarizeResult(pageBodies[index]!)]),
    ),
    documents: { status: "ok", count: documents.records.length } as const,
    ...documents.outcomes,
  };
  const failed = !upstreamHealthy || !courseCoverageSucceeded(course.code, endpointSummaries);
  const diff = failed ? EMPTY_DIFF : computeDiff(baseline, normalized);

  const entry: CourseManifestEntry = {
    courseCode: course.code,
    endpoints: endpointSummaries,
    diff: {
      added: diff.added.length,
      changed: diff.changed.length,
      removed: diff.removed.length,
    },
    outcome: failed ? "failed" : "success",
  };

  return { course, normalized, diff, entry } satisfies CourseOutcome;
});

/**
 * SRC-006: selects files referenced by this course's just-fetched prose (or
 * deterministically recognisable by name), downloads and extracts each, and
 * normalizes them so their content hash participates in the next diff. A
 * single document's download/extraction failure is skipped, not fatal —
 * it's supplementary evidence for AI interpretation, not required coverage.
 */
const collectDocuments = Effect.fn("collectDocuments")(function* (
  course: Course,
  dataDir: string,
  filesResult: EndpointResult<ReadonlyArray<CanvasFile>>,
  courseRecords: ReadonlyArray<NormalizedRecord>,
  changedRecords: ReadonlyArray<NormalizedRecord>,
  baseline: ReadonlyArray<NormalizedRecord>,
) {
  if (Result.isFailure(filesResult)) return { records: [], outcomes: {} };

  const referencedFromChanges = new Set(
    filesResult.success
      .filter((file) => referencedByForFile(file, changedRecords).length > 0)
      .map((file) => file.id),
  );
  const baselineDocuments = new Map(
    baseline.filter((record) => record.kind === "document").map((record) => [record.id, record]),
  );
  const changedIds = new Set(changedRecords.map((record) => record.id));
  const selected = filesResult.success.filter((file) => {
    if (!hasDownloadableUrl(file) || !isExtractableDocument(file)) return false;
    const references = referencedByForFile(file, courseRecords);
    return references.length > 0 || selectRelevantFiles([file], []).length === 1;
  });
  if (selected.length === 0) return { records: [], outcomes: {} };

  const destDir = `${dataDir}/documents/${course.code}`;
  const downloaded = yield* Effect.all(
    selected.map((file) => {
      const documentId = `course:${course.id}:document:${file.id}`;
      const cached = baselineDocuments.get(documentId);
      const fileChanged = changedIds.has(`course:${course.id}:file:${file.id}`);
      const cachedText = cached?.fields.text;
      const extraction =
        cached && !fileChanged && !referencedFromChanges.has(file.id)
          ? Effect.succeed({
              text: typeof cachedText === "string" ? cachedText : null,
            })
          : downloadAndExtract(file, destDir);
      return Effect.result(extraction);
    }),
    { concurrency: 4 },
  );

  const documentRecords: Array<NormalizedRecord> = [];
  const outcomes: Record<string, ReturnType<typeof summarizeResult>> = {};
  for (const [index, result] of downloaded.entries()) {
    const file = selected[index];
    if (!file) continue;
    outcomes[`document:${file.id}`] = summarizeResult(result);
    if (Result.isSuccess(result)) {
      documentRecords.push(
        normalizeDocument(
          course,
          file,
          result.success.text,
          referencedByForFile(file, courseRecords),
        ),
      );
    }
  }
  return { records: documentRecords, outcomes };
});
