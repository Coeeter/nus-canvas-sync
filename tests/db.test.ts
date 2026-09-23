import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importNotionRows, listActions, openPlanner, setContext } from "../src/db";

test("Notion edits become canonical actions and mutations are audited", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planner-db-"));
  try {
    const db = openPlanner(join(dir, "planner.db"));
    setContext(db, "run-1", "notion-import");
    const values = {
      action: "Prepare project proposal",
      course: "IS1128",
      status: "In progress" as const,
      availability: "Blocked" as const,
      weight: 10,
      startBy: "2026-09-01",
      due: "2026-09-20",
      source: "https://canvas.nus.edu.sg/courses/1/assignments/2",
      notes: "Waiting for teammates",
      archived: false,
    };
    const changes = importNotionRows(
      db,
      [{ pageId: "page-1", values }],
      "Term",
      new Date().toISOString(),
    );
    expect(changes).toHaveLength(1);
    expect(listActions(db)[0]).toMatchObject(values);
    expect(
      (db.query("SELECT count(*) AS count FROM audit_log").get() as { count: number }).count,
    ).toBe(1);
    expect(
      importNotionRows(db, [{ pageId: "page-1", values }], "Term", new Date().toISOString()),
    ).toHaveLength(0);
    expect(
      (db.query("SELECT count(*) AS count FROM audit_log").get() as { count: number }).count,
    ).toBe(1);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SQLite constraints keep progress and availability independent", () => {
  const db = openPlanner(":memory:");
  expect(() =>
    db
      .query(`INSERT INTO actions(id,action,course,status,availability,origin,term,created_at,updated_at)
    VALUES ('1','Group work','GESS1001','In progress','Blocked','agent','Term','now','now')`)
      .run(),
  ).not.toThrow();
  expect(() =>
    db
      .query(`INSERT INTO actions(id,action,course,status,availability,origin,term,created_at,updated_at)
    VALUES ('2','Bad','GESS1001','Waiting','Ready','agent','Term','now','now')`)
      .run(),
  ).toThrow();
  db.close();
});

test("a row removed from Notion is surfaced as an archived user change", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planner-db-"));
  try {
    const db = openPlanner(join(dir, "planner.db"));
    setContext(db, "run-1", "notion-import");
    const values = {
      action: "Duplicate row",
      course: "IS1128",
      status: "Not started" as const,
      availability: "Ready" as const,
      weight: null,
      startBy: null,
      due: null,
      source: null,
      notes: "",
      archived: false,
    };
    importNotionRows(db, [{ pageId: "page-1", values }], "Term", "now");
    const changes = importNotionRows(db, [], "Term", "later");
    expect(changes).toEqual([
      { pageId: "page-1", before: values, after: { ...values, archived: true } },
    ]);
    expect(listActions(db)[0]?.archived).toBe(true);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
