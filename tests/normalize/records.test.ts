import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { announcementSchema, quizSchema } from "../../schemas/canvas.schema";
import { COURSES } from "../../src/config/courses";
import { normalizeAnnouncement, normalizeQuiz } from "../../src/normalize/records";

const course = COURSES.find((candidate) => candidate.code === "GESS1001")!;

describe("quizSchema", () => {
  test("decodes a quiz with due_at, unlock_at, and lock_at omitted (canvas-cli SRC-002 gap)", () => {
    const raw = {
      id: 1,
      title: "Quiz 1",
      html_url: "https://canvas.nus.edu.sg/courses/1/quizzes/1",
      published: true,
      locked_for_user: false,
      quiz_type: "assignment",
    };
    const decoded = Schema.decodeUnknownSync(quizSchema)(raw);
    const normalized = normalizeQuiz(course, decoded);
    expect(normalized.fields.dueAt).toBeNull();
    expect(normalized.fields.unlockAt).toBeNull();
    expect(normalized.fields.lockAt).toBeNull();
  });
});

describe("announcementSchema", () => {
  test("decodes an announcement with url omitted (canvas-cli SRC-002 gap) and normalizes it to null", () => {
    const raw = {
      id: 1,
      title: "Reminder",
      message: "See you in class",
      posted_at: "2026-09-01T00:00:00Z",
    };
    const decoded = Schema.decodeUnknownSync(announcementSchema)(raw);
    const normalized = normalizeAnnouncement(course, decoded);
    expect(normalized.sourceUrl).toBeNull();
  });
});
