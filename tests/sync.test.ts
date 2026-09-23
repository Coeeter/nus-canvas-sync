import { expect, test } from "bun:test";
import { assertPreservedUserState, formatSyncTime } from "../src/sync";
import type { Action } from "../src/types";

const completed: Action = {
  id: "ex4",
  notionPageId: "page-ex4",
  origin: "imported",
  term: "AY2026-27-Semester-1",
  createdAt: "2026-09-01",
  updatedAt: "2026-09-23",
  action: "CS2030S ex4",
  course: "CS2030S",
  status: "Done",
  availability: "Ready",
  weight: null,
  startBy: null,
  due: null,
  source: null,
  notes: "",
  archived: false,
};

test("reconciliation preserves user-reported progress even if Canvas says unsubmitted", () => {
  expect(() =>
    assertPreservedUserState([completed], [{ ...completed, status: "Not started" }]),
  ).toThrow("user-owned Status");
  expect(() =>
    assertPreservedUserState([completed], [{ ...completed, availability: "Locked" }]),
  ).not.toThrow();
});

test("reconciliation cannot revive a row archived in Notion", () => {
  expect(() => assertPreservedUserState([{ ...completed, archived: true }], [completed])).toThrow(
    "user-archived",
  );
});

test("dashboard status includes local date and time", () => {
  expect(formatSyncTime(new Date("2026-09-23T03:10:00Z"), "Asia/Singapore")).toBe(
    "Wednesday, 23 September 2026 at 11:10 AM (Asia/Singapore)",
  );
});
