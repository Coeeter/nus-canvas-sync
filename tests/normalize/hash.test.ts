import { describe, expect, test } from "bun:test";
import { normalizeDate } from "../../src/normalize/dates";
import { contentHash } from "../../src/normalize/hash";

describe("contentHash", () => {
  test("is stable regardless of key order (SRC-002)", () => {
    const a = contentHash({ due_at: "2026-09-01", name: "Lab 1" });
    const b = contentHash({ name: "Lab 1", due_at: "2026-09-01" });
    expect(a).toBe(b);
  });

  test("changes when task-relevant content changes", () => {
    const a = contentHash({ due_at: "2026-09-01" });
    const b = contentHash({ due_at: "2026-09-02" });
    expect(a).not.toBe(b);
  });
});

describe("normalizeDate", () => {
  test("treats null, undefined, and the Go zero-value sentinel as unset", () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
    expect(normalizeDate("0001-01-01T00:00:00Z")).toBeNull();
  });

  test("passes through a real date", () => {
    expect(normalizeDate("2026-09-07T06:00:00Z")).toBe("2026-09-07T06:00:00Z");
  });
});
