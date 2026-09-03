import { Effect, Either } from "effect";
import type { CanvasFile, CanvasPlannerItem } from "../../schemas/canvas.schema";
import type { GithubCommit, GithubRepo } from "../../schemas/github.schema";
import { COURSES, type Course, type CourseCode } from "../config/courses";
import { computeDiff } from "../diff/compute";
import type { SemanticDiff } from "../diff/types";
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
import { downloadAndExtract, selectRelevantFiles } from "./documents";
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

export function collect(dataDir: string, now: Date = new Date()) {
  return withRunLock(dataDir, runCollection(dataDir, now));
}

interface CourseOutcome {
  course: Course;
  normalized: Array<NormalizedRecord>;
  diff: SemanticDiff;
  entry: CourseManifestEntry;
}

function runCollection(dataDir: string, now: Date) {
  return Effect.gen(function* () {
    const canvas = yield* CanvasClient;
    const github = yield* GithubClient;

    const startedAt = now.toISOString();
    const runId = now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");

    const viewerLoginResult = yield* Effect.either(github.viewerLogin);
    const reposResult = yield* Effect.either(github.repositories);

    const login = Either.isRight(viewerLoginResult) ? viewerLoginResult.right.toLowerCase() : null;
    const relevantRepos =
      Either.isRight(reposResult) && login !== null
        ? filterRelevantRepos(reposResult.right, login)
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
        Effect.either(github.commits(repoName)).pipe(
          Effect.map((result) => [repoName, result] as const),
        ),
      ),
      { concurrency: COMMIT_FETCH_CONCURRENCY },
    );

    const plannerResult = yield* Effect.either(canvas.plannerItems(COURSES, PLANNER_WINDOW));
    const plannerByCourse = groupPlannerByCourse(plannerResult);

    const courseOutcomes = yield* Effect.all(
      COURSES.map((course) =>
        collectCourse(course, {
          canvas,
          dataDir,
          plannerRecords: plannerByCourse.get(course.id) ?? [],
          githubRepos: course.code === "CS2030S" ? relevantRepos : [],
          githubCommits: course.code === "CS2030S" ? commitResults : [],
        }),
      ),
      { concurrency: "unbounded" },
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
      finishedAt: new Date().toISOString(),
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
}

function groupPlannerByCourse(
  plannerResult: EndpointResult<ReadonlyArray<CanvasPlannerItem>>,
): Map<number, Array<NormalizedRecord>> {
  const byCourse = new Map<number, Array<NormalizedRecord>>();
  if (Either.isLeft(plannerResult)) return byCourse;
  for (const item of plannerResult.right) {
    const course = COURSES.find((c) => c.id === item.course_id);
    if (!course) continue;
    const list = byCourse.get(course.id) ?? [];
    list.push(normalizePlannerItem(course, item));
    byCourse.set(course.id, list);
  }
  return byCourse;
}

interface CollectCourseDeps {
  canvas: CanvasClient;
  dataDir: string;
  plannerRecords: Array<NormalizedRecord>;
  githubRepos: ReadonlyArray<GithubRepo>;
  githubCommits: ReadonlyArray<readonly [string, EndpointResult<ReadonlyArray<GithubCommit>>]>;
}

function collectCourse(course: Course, deps: CollectCourseDeps) {
  return Effect.gen(function* () {
    const { canvas, dataDir, plannerRecords, githubRepos, githubCommits } = deps;

    const [assignments, quizzes, announcements, files, modules, frontPage, pagesIndex] =
      yield* Effect.all(
        [
          Effect.either(canvas.assignments(course)),
          Effect.either(canvas.quizzes(course)),
          Effect.either(canvas.announcements(course)),
          Effect.either(canvas.files(course)),
          Effect.either(canvas.modules(course)),
          Effect.either(canvas.frontPage(course)),
          Effect.either(canvas.pagesIndex(course)),
        ],
        { concurrency: "unbounded" },
      );

    const pageUrls = Either.isRight(pagesIndex) ? pagesIndex.right.map((page) => page.url) : [];
    const pageBodies = yield* Effect.all(
      pageUrls.map((url) => Effect.either(canvas.pageBody(course, url))),
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

    const courseRecords = normalizeCourseRecords(course, endpoints);
    const documentRecords = yield* collectDocuments(course, dataDir, files, courseRecords);

    const normalized = [...courseRecords, ...documentRecords, ...plannerRecords];
    normalized.push(...githubRepos.map((repo) => normalizeGithubRepo(course, repo)));
    for (const [repoName, result] of githubCommits) {
      if (Either.isRight(result)) {
        normalized.push(
          ...result.right.map((commit) => normalizeGithubCommit(course, repoName, commit)),
        );
      }
    }

    const baseline = yield* readBaseline(dataDir, course.code);
    const diff = computeDiff(baseline, normalized);

    const endpointSummaries = {
      assignments: summarizeResult(assignments),
      quizzes: summarizeResult(quizzes),
      announcements: summarizeResult(announcements),
      files: summarizeResult(files),
      modules: summarizeResult(modules),
      frontPage: summarizeResult(frontPage),
      pages: summarizeResult(pagesIndex),
      documents: { status: "ok", count: documentRecords.length } as const,
    };
    const failed = Object.values(endpointSummaries).some(
      (e) => e.status === "TaskAffectingFailureError",
    );

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
}

/**
 * SRC-006: selects files referenced by this course's just-fetched prose (or
 * deterministically recognisable by name), downloads and extracts each, and
 * normalizes them so their content hash participates in the next diff. A
 * single document's download/extraction failure is skipped, not fatal —
 * it's supplementary evidence for AI interpretation, not required coverage.
 */
function collectDocuments(
  course: Course,
  dataDir: string,
  filesResult: EndpointResult<ReadonlyArray<CanvasFile>>,
  courseRecords: ReadonlyArray<NormalizedRecord>,
) {
  return Effect.gen(function* () {
    if (Either.isLeft(filesResult)) return [];

    const proseBlobs = courseRecords.flatMap((r) =>
      Object.values(r.fields).filter((v): v is string => typeof v === "string"),
    );
    const selected = selectRelevantFiles(filesResult.right, proseBlobs);
    if (selected.length === 0) return [];

    const destDir = `${dataDir}/documents/${course.code}`;
    const downloaded = yield* Effect.all(
      selected.map((file) => Effect.either(downloadAndExtract(file, destDir))),
      { concurrency: 4 },
    );

    const documentRecords: Array<NormalizedRecord> = [];
    for (const [index, result] of downloaded.entries()) {
      if (Either.isRight(result)) {
        const file = selected[index];
        if (file) documentRecords.push(normalizeDocument(course, file, result.right.text));
      }
    }
    return documentRecords;
  });
}
