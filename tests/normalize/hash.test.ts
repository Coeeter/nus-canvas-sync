import { describe, expect, test } from "bun:test";
import { normalizeDate } from "../../src/normalize/dates";
import { contentHash } from "../../src/normalize/hash";
import { normalizeAnnouncement, normalizeModule } from "../../src/normalize/records";

const course = { id: 94257, code: "GEA1000" } as const;

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

describe("normalized source safety", () => {
  test("removes Canvas verifier and token values from persisted URLs and prose", () => {
    const record = normalizeAnnouncement(course, {
      id: 1,
      title: "Brief",
      message:
        '<a href="https://canvas.nus.edu.sg/files/9?verifier=secret123&amp;token=other456">open</a>',
      posted_at: "2026-09-03T00:00:00Z",
      url: "https://canvas.nus.edu.sg/announcements/1?access_token=topsecret",
    });

    expect(JSON.stringify(record)).not.toContain("secret123");
    expect(JSON.stringify(record)).not.toContain("other456");
    expect(JSON.stringify(record)).not.toContain("topsecret");
    expect(record.fields.message).toContain("[redacted]");
  });

  test("retains module and item release evidence plus canonical source URLs", () => {
    const record = normalizeModule(course, {
      id: 163043,
      name: "WEEK 4",
      published: false,
      unlock_at: "2026-09-01T06:00:00Z",
      state: "completed",
      items: [
        {
          id: 835075,
          title: "Week 4 Content Videos",
          type: "ExternalTool",
          content_id: 128,
          html_url: "https://canvas.nus.edu.sg/courses/94257/modules/items/835075",
          published: false,
          content_details: {
            unlock_at: null,
            locked_for_user: false,
          },
        },
      ],
    });

    expect(record.sourceUrl).toBe("https://canvas.nus.edu.sg/courses/94257/modules#module_163043");
    expect(record.fields).toMatchObject({
      unlockAt: "2026-09-01T06:00:00Z",
      state: "completed",
      items: [
        {
          id: 835075,
          published: false,
          lockedForUser: false,
          htmlUrl: "https://canvas.nus.edu.sg/courses/94257/modules/items/835075",
        },
      ],
    });
  });
});
