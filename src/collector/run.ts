import { DateTime, Effect, Result } from "effect";
import type { CanvasFile, CanvasPlannerItem } from "../../schemas/canvas.schema";
import type { GithubCommit, GithubRepo } from "../../schemas/github.schema";
import { COURSES, type Course, type CourseCode, SEMESTER_WINDOW } from "../config/courses";
import { computeDiff } from "../diff/compute";
import { EMPTY_DIFF, type SemanticDiff } from "../diff/types";
import { TaskAffectingFailureError } from "../errors";
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
const PLANNER_WINDOW = SEMESTER_WINDOW;
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
        upstreamHealthy: course.code !== "CS2030S" || githubHealthy,
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
    phase: "collected",
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

export const collectCourse = Effect.fn("collectCourse")(function* (
  course: Course,
  deps: CollectCourseDeps,
) {
  const { canvas, dataDir, plannerRecords, githubRepos, githubCommits, upstreamHealthy } = deps;

  const [assignments, quizzes, announcements, files, inlineModules, frontPage, pagesIndex] =
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

  const modules = Result.isFailure(inlineModules)
    ? inlineModules
    : yield* Effect.result(
        Effect.forEach(
          inlineModules.success,
          (module) =>
            Effect.gen(function* () {
              if (
                module.items &&
                (module.items_count === undefined || module.items.length === module.items_count)
              )
                return module;
              const items = yield* canvas.moduleItems(course, module.id);
              if (module.items_count !== undefined && items.length !== module.items_count) {
                return yield* new TaskAffectingFailureError({
                  command: "collect module items",
                  message: `Module ${module.id} item count changed or is incomplete`,
                });
              }
              return { ...module, items };
            }),
          { concurrency: PAGE_FETCH_CONCURRENCY },
        ),
      );
  const pageUrls = new Set(
    Result.isSuccess(pagesIndex) ? pagesIndex.success.map((page) => page.url) : [],
  );
  if (Result.isSuccess(modules))
    for (const module of modules.success) {
      for (const item of module.items ?? []) if (item.page_url) pageUrls.add(item.page_url);
    }
  const discoverPages = (value: unknown) => {
    for (const match of JSON.stringify(value).matchAll(
      new RegExp(`/courses/${course.id}/pages/([a-zA-Z0-9_%.-]+)`, "g"),
    )) {
      let slug = match[1]!;
      try {
        slug = decodeURIComponent(slug);
      } catch {
        // Fetch the literal slug so a malformed link becomes a recorded endpoint failure.
      }
      pageUrls.add(slug);
    }
  };
  if (Result.isSuccess(frontPage)) discoverPages(frontPage.success);
  if (Result.isSuccess(announcements)) discoverPages(announcements.success);
  if (Result.isSuccess(assignments)) discoverPages(assignments.success);
  const fetchedPages = new Map<
    string,
    EndpointResult<import("../../schemas/canvas.schema").CanvasPageBody>
  >();
  while ([...pageUrls].some((url) => !fetchedPages.has(url))) {
    const batch = [...pageUrls].filter((url) => !fetchedPages.has(url));
    if (pageUrls.size > 500)
      return yield* new TaskAffectingFailureError({
        command: "collect pages",
        message: "Page discovery exceeded 500 distinct course pages",
      });
    const results = yield* Effect.forEach(
      batch,
      (url) => Effect.result(canvas.pageBody(course, url)),
      { concurrency: PAGE_FETCH_CONCURRENCY },
    );
    for (const [index, result] of results.entries()) {
      fetchedPages.set(batch[index]!, result);
      if (Result.isSuccess(result)) discoverPages(result.success);
    }
  }
  const pageBodies = [...fetchedPages.values()];
  const fileIds = new Set<number>();
  const discovery = [assignments, announcements, modules, frontPage, ...pageBodies].flatMap(
    (result) => (result._tag === "Success" ? [result.success as unknown] : []),
  );
  const serializedDiscovery = JSON.stringify(discovery);
  const foreignFileIds = new Set(
    [...serializedDiscovery.matchAll(/\/courses\/(\d+)\/files\/(\d+)/g)]
      .filter((match) => Number(match[1]) !== course.id)
      .map((match) => Number(match[2])),
  );
  for (const match of serializedDiscovery.matchAll(/\/files\/(\d+)/g)) {
    const id = Number(match[1]);
    if (!foreignFileIds.has(id)) fileIds.add(id);
  }
  if (Result.isSuccess(modules))
    for (const module of modules.success) {
      for (const item of module.items ?? [])
        if (item.type === "File" && item.content_id) fileIds.add(item.content_id);
    }
  const collectedFiles = Result.isSuccess(files) ? [...files.success] : [];
  const missingFileIds = [...fileIds].filter(
    (id) => !collectedFiles.some((file) => file.id === id),
  );
  const fileResults = yield* Effect.forEach(
    missingFileIds,
    (id) => Effect.result(canvas.file(id)),
    { concurrency: PAGE_FETCH_CONCURRENCY },
  );
  for (const result of fileResults)
    if (Result.isSuccess(result)) collectedFiles.push(result.success);

  const endpoints: CourseEndpointResults = {
    assignments,
    quizzes,
    announcements,
    files: Result.succeed(collectedFiles),
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
    Result.succeed(collectedFiles),
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
      [...fetchedPages].map(([url, result]) => [`page:${url}`, summarizeResult(result)]),
    ),
    ...Object.fromEntries(
      missingFileIds.map((id, index) => [`file:${id}`, summarizeResult(fileResults[index]!)]),
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
 * selected document failure is a course coverage failure.
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
    if (!isExtractableDocument(file)) return false;
    const references = referencedByForFile(file, courseRecords);
    return references.length > 0 || selectRelevantFiles([file], []).length === 1;
  });
  if (selected.length === 0) return { records: [], outcomes: {} };

  const destDir = `${dataDir}/documents/${course.code}`;
  const downloaded = yield* Effect.all(
    selected.map((file) => {
      if (file.locked_for_user === true) return Effect.result(Effect.succeed({ text: null }));
      if (!hasDownloadableUrl(file))
        return Effect.result(
          Effect.fail(
            new TaskAffectingFailureError({
              command: `download file ${file.id}`,
              message: "Required document has no downloadable URL; source coverage is incomplete",
            }),
          ),
        );
      const documentId = `course:${course.id}:document:${file.id}`;
      const cached = baselineDocuments.get(documentId);
      const fileChanged = changedIds.has(`course:${course.id}:file:${file.id}`);
      const cachedText = cached?.fields.text;
      const extraction =
        cached &&
        typeof cachedText === "string" &&
        cachedText.trim().length > 0 &&
        !fileChanged &&
        !referencedFromChanges.has(file.id)
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
      if (file.locked_for_user === true) {
        const record = normalizeDocument(
          course,
          file,
          "",
          referencedByForFile(file, courseRecords),
        );
        record.fields.lockedForUser = true;
        outcomes[`document:${file.id}`] = {
          status: "ok",
          detail: "Canvas confirms locked content; extraction deferred",
        };
        documentRecords.push(record);
        continue;
      }
      if (!result.success.text?.trim()) {
        outcomes[`document:${file.id}`] = {
          status: "TaskAffectingFailureError",
          detail: "Selected document contained no extractable text",
        };
        continue;
      }
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
