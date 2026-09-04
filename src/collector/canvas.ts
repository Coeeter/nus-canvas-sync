import { Context, Effect, Layer, Redacted, type Schema } from "effect";
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

export class CanvasClient extends Context.Service<CanvasClient>()("CanvasClient", {
  make: Effect.gen(function* () {
    const config = yield* AppConfig;
    const env = {
      CANVAS_URL: config.canvasUrl,
      CANVAS_TOKEN: Redacted.value(config.canvasToken),
      PATH: process.env.PATH ?? "",
    };

    const call = Effect.fn("CanvasClient.call")(function* <A>(
      course: Course,
      endpoint: CourseEndpoint,
      args: ReadonlyArray<string>,
      schema: Schema.ConstraintDecoder<A, never>,
    ) {
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

    const callRequired = Effect.fn("CanvasClient.callRequired")(function* <A>(
      args: ReadonlyArray<string>,
      schema: Schema.ConstraintDecoder<A, never>,
    ) {
      const fullArgs = [...args, "--no-cache", "--quiet", "-o", "json"];
      const result = yield* runProcess("canvas", fullArgs, env);
      return yield* decodeRequired({
        command: `canvas ${fullArgs.join(" ")}`,
        result,
        schema,
      });
    });

    const courseArgs = (id: number) => String(id);

    const assignments = Effect.fn("CanvasClient.assignments")(function* (course: Course) {
      return yield* call(
        course,
        "assignments",
        ["assignments", "list", "--course-id", courseArgs(course.id), "--include", "submission"],
        assignmentListSchema,
      );
    });

    const quizzes = Effect.fn("CanvasClient.quizzes")(function* (course: Course) {
      return yield* call(
        course,
        "quizzes",
        ["quizzes", "list", "--course-id", courseArgs(course.id)],
        quizListSchema,
      );
    });

    const announcements = Effect.fn("CanvasClient.announcements")(function* (course: Course) {
      return yield* call(
        course,
        "announcements",
        ["announcements", "list", "--course-id", courseArgs(course.id)],
        announcementListSchema,
      );
    });

    const files = Effect.fn("CanvasClient.files")(function* (course: Course) {
      return yield* call(
        course,
        "files",
        ["files", "list", "--course-id", courseArgs(course.id)],
        fileListSchema,
      );
    });

    const modules = Effect.fn("CanvasClient.modules")(function* (course: Course) {
      return yield* call(
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
    });

    const frontPage = Effect.fn("CanvasClient.frontPage")(function* (course: Course) {
      return yield* call(
        course,
        "frontPage",
        ["pages", "front", "--course-id", courseArgs(course.id)],
        pageBodySchema,
      );
    });

    const pagesIndex = Effect.fn("CanvasClient.pagesIndex")(function* (course: Course) {
      return yield* call(
        course,
        "pages",
        ["pages", "list", "--course-id", courseArgs(course.id)],
        pageIndexSchema,
      );
    });

    const pageBody = Effect.fn("CanvasClient.pageBody")(function* (course: Course, url: string) {
      return yield* callRequired(
        ["pages", "get", "--course-id", courseArgs(course.id), url],
        pageBodySchema,
      );
    });

    const plannerItems = Effect.fn("CanvasClient.plannerItems")(function* (
      courses: ReadonlyArray<Course>,
      window: { startDate: string; endDate: string },
    ) {
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
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(AppConfig.layer));
}
