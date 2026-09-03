import { Effect, Redacted, type Schema } from "effect";
import {
  announcementListSchema,
  assignmentListSchema,
  fileListSchema,
  moduleListSchema,
  pageBodySchema,
  pageIndexSchema,
  plannerListSchema,
  quizListSchema,
} from "../../schemas/canvas.schema";
import type { Course, CourseEndpoint } from "../config/courses";
import { AppConfig } from "../config/env";
import { decodeEndpoint, decodeRequired } from "./outcome";
import { runProcess } from "./process";

export class CanvasClient extends Effect.Service<CanvasClient>()("CanvasClient", {
  accessors: true,
  dependencies: [AppConfig.Default],
  effect: Effect.gen(function* () {
    const config = yield* AppConfig;
    const env = {
      CANVAS_URL: config.canvasUrl,
      CANVAS_TOKEN: Redacted.value(config.canvasToken),
      PATH: process.env.PATH ?? "",
    };

    const call = <A, I>(
      course: Course,
      endpoint: CourseEndpoint,
      args: ReadonlyArray<string>,
      schema: Schema.Schema<A, I>,
    ) =>
      Effect.gen(function* () {
        const fullArgs = [...args, "--no-cache", "--quiet", "-o", "json"];
        const result = yield* runProcess("canvas", fullArgs, env);
        return yield* decodeEndpoint({
          course: course.code,
          endpoint,
          command: `canvas ${fullArgs.join(" ")}`,
          result,
          schema,
        });
      });

    const courseArgs = (id: number) => String(id);

    const assignments = (course: Course) =>
      call(
        course,
        "assignments",
        ["assignments", "list", "--course-id", courseArgs(course.id), "--include", "submission"],
        assignmentListSchema,
      );

    const quizzes = (course: Course) =>
      call(
        course,
        "quizzes",
        ["quizzes", "list", "--course-id", courseArgs(course.id)],
        quizListSchema,
      );

    const announcements = (course: Course) =>
      call(
        course,
        "announcements",
        ["announcements", "list", "--course-id", courseArgs(course.id)],
        announcementListSchema,
      );

    const files = (course: Course) =>
      call(
        course,
        "files",
        ["files", "list", "--course-id", courseArgs(course.id)],
        fileListSchema,
      );

    const modules = (course: Course) =>
      call(
        course,
        "modules",
        [
          "modules",
          "list",
          "--course-id",
          courseArgs(course.id),
          "--include",
          "items,content_details",
        ],
        moduleListSchema,
      );

    const frontPage = (course: Course) =>
      call(
        course,
        "frontPage",
        ["pages", "front", "--course-id", courseArgs(course.id)],
        pageBodySchema,
      );

    const pagesIndex = (course: Course) =>
      call(
        course,
        "pages",
        ["pages", "list", "--course-id", courseArgs(course.id)],
        pageIndexSchema,
      );

    const pageBody = (course: Course, url: string) =>
      call(
        course,
        "pages",
        ["pages", "get", "--course-id", courseArgs(course.id), url],
        pageBodySchema,
      );

    const plannerItems = (
      courses: ReadonlyArray<Course>,
      window: { startDate: string; endDate: string },
    ) =>
      Effect.gen(function* () {
        const context = courses.map((c) => `course_${c.id}`).join(",");
        const args = [
          "planner",
          "items",
          "--context",
          context,
          "--start-date",
          window.startDate,
          "--end-date",
          window.endDate,
          "--no-cache",
          "--quiet",
          "-o",
          "json",
        ];
        const result = yield* runProcess("canvas", args, env);
        return yield* decodeRequired({
          command: `canvas ${args.join(" ")}`,
          result,
          schema: plannerListSchema,
        });
      });

    return {
      assignments,
      quizzes,
      announcements,
      files,
      modules,
      frontPage,
      pagesIndex,
      pageBody,
      plannerItems,
    };
  }),
}) {}
