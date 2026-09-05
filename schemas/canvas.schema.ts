import { Schema } from "effect";

/**
 * Schemas validate only the fields the normalizer reads (SRC-002, SRC-006).
 * Canvas dates are either JSON `null` or, from some canvas-cli struct paths,
 * the Go zero-value sentinel `"0001-01-01T00:00:00Z"`; both decode fine here
 * and `normalize/dates.ts` treats either as "unset".
 */
const nullableDate = Schema.NullOr(Schema.String);

export const submissionSchema = Schema.Struct({
  workflow_state: Schema.String,
  submitted_at: nullableDate,
  grade: Schema.NullOr(Schema.String),
  score: Schema.NullOr(Schema.Number),
  late: Schema.Boolean,
  missing: Schema.Boolean,
});
export type CanvasSubmission = typeof submissionSchema.Type;

export const assignmentSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  due_at: nullableDate,
  unlock_at: nullableDate,
  lock_at: nullableDate,
  html_url: Schema.String,
  published: Schema.Boolean,
  locked_for_user: Schema.Boolean,
  submission_types: Schema.Array(Schema.String),
  points_possible: Schema.NullOr(Schema.Number),
  quiz_id: Schema.optional(Schema.NullOr(Schema.Number)),
  is_quiz_assignment: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  submission: Schema.optional(Schema.NullOr(submissionSchema)),
});
export const assignmentListSchema = Schema.Array(assignmentSchema);
export type CanvasAssignment = typeof assignmentSchema.Type;

export const quizSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  due_at: Schema.optional(nullableDate),
  lock_at: Schema.optional(nullableDate),
  unlock_at: Schema.optional(nullableDate),
  html_url: Schema.String,
  published: Schema.Boolean,
  locked_for_user: Schema.Boolean,
  quiz_type: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
});
export const quizListSchema = Schema.Array(quizSchema);
export type CanvasQuiz = typeof quizSchema.Type;

export const announcementSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  message: Schema.NullOr(Schema.String),
  posted_at: nullableDate,
  url: Schema.optional(Schema.NullOr(Schema.String)),
});
export const announcementListSchema = Schema.Array(announcementSchema);
export type CanvasAnnouncement = typeof announcementSchema.Type;

export const fileSchema = Schema.Struct({
  id: Schema.Number,
  display_name: Schema.String,
  url: Schema.String,
  updated_at: nullableDate,
});
export const fileListSchema = Schema.Array(fileSchema);
export type CanvasFile = typeof fileSchema.Type;

export const moduleItemSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  type: Schema.optional(Schema.String),
  content_id: Schema.optional(Schema.Number),
  html_url: Schema.optional(Schema.String),
  page_url: Schema.optional(Schema.String),
  external_url: Schema.optional(Schema.String),
  published: Schema.optional(Schema.Boolean),
  content_details: Schema.optional(
    Schema.Struct({
      due_at: Schema.optional(nullableDate),
      unlock_at: Schema.optional(nullableDate),
      lock_at: Schema.optional(nullableDate),
      points_possible: Schema.optional(Schema.NullOr(Schema.Number)),
      locked_for_user: Schema.optional(Schema.Boolean),
    }),
  ),
});
export const moduleSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  published: Schema.optional(Schema.Boolean),
  unlock_at: Schema.optional(nullableDate),
  state: Schema.optional(Schema.String),
  items_count: Schema.optional(Schema.Number),
  items: Schema.optional(Schema.NullOr(Schema.Array(moduleItemSchema))),
});
export const moduleListSchema = Schema.Array(moduleSchema);
export type CanvasModule = typeof moduleSchema.Type;
export type CanvasModuleItem = typeof moduleItemSchema.Type;

export const pageIndexEntrySchema = Schema.Struct({
  page_id: Schema.Number,
  url: Schema.String,
  title: Schema.String,
  updated_at: nullableDate,
  published: Schema.Boolean,
  front_page: Schema.Boolean,
});
export const pageIndexSchema = Schema.Array(pageIndexEntrySchema);
export type CanvasPageIndexEntry = typeof pageIndexEntrySchema.Type;

export const pageBodySchema = Schema.Struct({
  page_id: Schema.Number,
  url: Schema.String,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  updated_at: nullableDate,
  published: Schema.Boolean,
});
export type CanvasPageBody = typeof pageBodySchema.Type;

const plannerSubmissionsSchema = Schema.Union([
  Schema.Literal(false),
  Schema.Struct({
    excused: Schema.Boolean,
    graded: Schema.Boolean,
    late: Schema.Boolean,
    missing: Schema.Boolean,
    needs_grading: Schema.Boolean,
    submitted: Schema.Boolean,
  }),
]);

export const plannerItemSchema = Schema.Struct({
  course_id: Schema.Number,
  plannable_type: Schema.String,
  plannable_id: Schema.Number,
  plannable_date: Schema.String,
  submissions: plannerSubmissionsSchema,
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  plannable: Schema.Struct({ id: Schema.Number, title: Schema.optional(Schema.String) }),
});
export const plannerListSchema = Schema.Array(plannerItemSchema);
export type CanvasPlannerItem = typeof plannerItemSchema.Type;
