import type {
  CanvasAnnouncement,
  CanvasAssignment,
  CanvasFile,
  CanvasModule,
  CanvasPageBody,
  CanvasPlannerItem,
  CanvasQuiz,
} from "../../schemas/canvas.schema";
import type { GithubCommit, GithubRepo } from "../../schemas/github.schema";
import type { Course } from "../config/courses";
import { normalizeDate } from "./dates";
import { contentHash } from "./hash";
import { type NormalizedRecord, sourceId } from "./types";

function record(
  course: Course,
  kind: NormalizedRecord["kind"],
  id: string | number,
  sourceUrl: string | null,
  fields: Record<string, unknown>,
) {
  return {
    id: sourceId(course.id, kind, id),
    courseCode: course.code,
    kind,
    sourceUrl,
    contentHash: contentHash(fields),
    fields,
  };
}

export function normalizeAssignment(course: Course, raw: CanvasAssignment) {
  return record(course, "assignment", raw.id, raw.html_url, {
    name: raw.name,
    dueAt: normalizeDate(raw.due_at),
    unlockAt: normalizeDate(raw.unlock_at),
    lockAt: normalizeDate(raw.lock_at),
    published: raw.published,
    lockedForUser: raw.locked_for_user,
    submissionTypes: raw.submission_types,
    pointsPossible: raw.points_possible,
    submission: raw.submission
      ? {
          workflowState: raw.submission.workflow_state,
          submittedAt: normalizeDate(raw.submission.submitted_at),
          grade: raw.submission.grade,
          score: raw.submission.score,
          late: raw.submission.late,
          missing: raw.submission.missing,
        }
      : null,
  });
}

export function normalizeQuiz(course: Course, raw: CanvasQuiz) {
  return record(course, "quiz", raw.id, raw.html_url, {
    title: raw.title,
    dueAt: normalizeDate(raw.due_at),
    unlockAt: normalizeDate(raw.unlock_at),
    lockAt: normalizeDate(raw.lock_at),
    published: raw.published,
    lockedForUser: raw.locked_for_user,
    quizType: raw.quiz_type,
  });
}

export function normalizeAnnouncement(course: Course, raw: CanvasAnnouncement) {
  return record(course, "announcement", raw.id, raw.url, {
    title: raw.title,
    message: raw.message,
    postedAt: normalizeDate(raw.posted_at),
  });
}

export function normalizeFile(course: Course, raw: CanvasFile) {
  return record(course, "file", raw.id, raw.url, {
    displayName: raw.display_name,
    updatedAt: normalizeDate(raw.updated_at),
  });
}

export function normalizeModule(course: Course, raw: CanvasModule) {
  return record(course, "module", raw.id, null, {
    name: raw.name,
    items: (raw.items ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type ?? null,
      contentId: item.content_id ?? null,
      dueAt: normalizeDate(item.content_details?.due_at),
      unlockAt: normalizeDate(item.content_details?.unlock_at),
      lockAt: normalizeDate(item.content_details?.lock_at),
      pointsPossible: item.content_details?.points_possible ?? null,
    })),
  });
}

export function normalizePage(course: Course, raw: CanvasPageBody) {
  return record(course, "page", raw.url, null, {
    title: raw.title,
    body: raw.body,
    updatedAt: normalizeDate(raw.updated_at),
    published: raw.published,
  });
}

export function normalizePlannerItem(course: Course, raw: CanvasPlannerItem) {
  return record(
    course,
    "planner-item",
    `${raw.plannable_type}:${raw.plannable_id}`,
    raw.html_url ?? null,
    {
      plannableType: raw.plannable_type,
      plannableDate: raw.plannable_date,
      title: raw.plannable.title ?? null,
      submissions: raw.submissions,
    },
  );
}

export function normalizeGithubRepo(course: Course, raw: GithubRepo) {
  return record(course, "github-repo", raw.name, raw.url, {
    description: raw.description,
    isPrivate: raw.isPrivate,
    updatedAt: raw.updatedAt,
    defaultBranch: raw.defaultBranchRef?.name ?? null,
  });
}

export function normalizeDocument(course: Course, file: CanvasFile, text: string | null) {
  return record(course, "document", file.id, file.url, {
    displayName: file.display_name,
    text,
  });
}

export function normalizeGithubCommit(course: Course, repoName: string, raw: GithubCommit) {
  return record(course, "github-commit", `${repoName}:${raw.sha}`, raw.html_url, {
    repoName,
    message: raw.commit.message,
    authorDate: raw.commit.author.date,
  });
}
