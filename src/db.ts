import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { Action, ActionValues, NotionRow } from "./types";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS runtime_context (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  run_id TEXT NOT NULL,
  actor TEXT NOT NULL
);
INSERT OR IGNORE INTO runtime_context VALUES (1, 'bootstrap', 'system');
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  notion_page_id TEXT UNIQUE,
  action TEXT NOT NULL CHECK (length(trim(action)) > 0),
  course TEXT NOT NULL CHECK (length(trim(course)) > 0),
  status TEXT NOT NULL CHECK (status IN ('Not started','In progress','Done','Dropped')),
  availability TEXT NOT NULL CHECK (availability IN ('Locked','Ready','Blocked','Review')),
  weight REAL CHECK (weight IS NULL OR (weight >= 0 AND weight <= 100)),
  start_by TEXT,
  due TEXT,
  source TEXT CHECK (source IS NULL OR source LIKE 'http%://%'),
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  origin TEXT NOT NULL CHECK (origin IN ('manual','agent','imported')),
  term TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notion_snapshot (
  notion_page_id TEXT PRIMARY KEY,
  values_json TEXT NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','pending_publish','success','failed')),
  initial_hash TEXT,
  final_hash TEXT,
  notion_diff_json TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  run_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  operation TEXT NOT NULL,
  row_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT
);
CREATE TABLE IF NOT EXISTS agent_checks (
  run_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('complete','failed')),
  detail TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, scope)
);
CREATE TRIGGER IF NOT EXISTS actions_audit_insert AFTER INSERT ON actions BEGIN
  INSERT INTO audit_log(timestamp,run_id,actor,operation,row_id,after_json)
  SELECT CURRENT_TIMESTAMP,run_id,actor,'insert',NEW.id,json_object(
    'id',NEW.id,'notionPageId',NEW.notion_page_id,'action',NEW.action,'course',NEW.course,
    'status',NEW.status,'availability',NEW.availability,'weight',NEW.weight,
    'startBy',NEW.start_by,'due',NEW.due,'source',NEW.source,'notes',NEW.notes,
    'archived',NEW.archived,'origin',NEW.origin,'term',NEW.term)
  FROM runtime_context WHERE singleton=1;
END;
CREATE TRIGGER IF NOT EXISTS actions_audit_update AFTER UPDATE ON actions BEGIN
  INSERT INTO audit_log(timestamp,run_id,actor,operation,row_id,before_json,after_json)
  SELECT CURRENT_TIMESTAMP,run_id,actor,'update',NEW.id,
    json_object('action',OLD.action,'course',OLD.course,'status',OLD.status,'availability',OLD.availability,
      'weight',OLD.weight,'startBy',OLD.start_by,'due',OLD.due,'source',OLD.source,'notes',OLD.notes,
      'archived',OLD.archived),
    json_object('action',NEW.action,'course',NEW.course,'status',NEW.status,'availability',NEW.availability,
      'weight',NEW.weight,'startBy',NEW.start_by,'due',NEW.due,'source',NEW.source,'notes',NEW.notes,
      'archived',NEW.archived)
  FROM runtime_context WHERE singleton=1;
END;
CREATE TRIGGER IF NOT EXISTS actions_audit_delete AFTER DELETE ON actions BEGIN
  INSERT INTO audit_log(timestamp,run_id,actor,operation,row_id,before_json)
  SELECT CURRENT_TIMESTAMP,run_id,actor,'delete',OLD.id,json_object(
    'id',OLD.id,'notionPageId',OLD.notion_page_id,'action',OLD.action,'course',OLD.course,
    'status',OLD.status,'availability',OLD.availability,'weight',OLD.weight,
    'startBy',OLD.start_by,'due',OLD.due,'source',OLD.source,'notes',OLD.notes,
    'archived',OLD.archived,'origin',OLD.origin,'term',OLD.term)
  FROM runtime_context WHERE singleton=1;
END;`;

export function openPlanner(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec(SCHEMA);
  return db;
}

export function setContext(db: Database, runId: string, actor: string): void {
  db.query("UPDATE runtime_context SET run_id = ?, actor = ? WHERE singleton = 1").run(
    runId,
    actor,
  );
}

export function startRun(db: Database, runId: string, startedAt: string): void {
  setContext(db, runId, "orchestrator");
  db.query("INSERT INTO runs(id,started_at,status) VALUES (?,?, 'running')").run(runId, startedAt);
}

export function importNotionRows(
  db: Database,
  rows: Array<NotionRow>,
  term: string,
  now: string,
): Array<{ pageId: string; before: ActionValues | null; after: ActionValues }> {
  const changed: Array<{ pageId: string; before: ActionValues | null; after: ActionValues }> = [];
  const previous = db.query("SELECT values_json FROM notion_snapshot WHERE notion_page_id = ?");
  const current = db.query("SELECT * FROM actions WHERE notion_page_id = ?");
  const insert = db.query(`INSERT INTO actions(
    id,notion_page_id,action,course,status,availability,weight,start_by,due,source,notes,
    archived,origin,term,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const update = db.query(`UPDATE actions SET action=?,course=?,status=?,availability=?,weight=?,
    start_by=?,due=?,source=?,notes=?,archived=?,updated_at=? WHERE notion_page_id=?`);
  const snapshot = db.query(`INSERT INTO notion_snapshot(notion_page_id,values_json,captured_at)
    VALUES (?,?,?) ON CONFLICT(notion_page_id) DO UPDATE SET values_json=excluded.values_json,
    captured_at=excluded.captured_at`);
  db.transaction(() => {
    const context = db.query("SELECT run_id FROM runtime_context WHERE singleton=1").get() as {
      run_id: string;
    };
    setContext(db, context.run_id, "notion-import");
    const seen = new Set(rows.map((row) => row.pageId));
    for (const row of rows) {
      const priorRaw = previous.get(row.pageId) as { values_json: string } | null;
      const before = priorRaw ? (JSON.parse(priorRaw.values_json) as ActionValues) : null;
      if (JSON.stringify(before) !== JSON.stringify(row.values))
        changed.push({ pageId: row.pageId, before, after: row.values });
      const found = current.get(row.pageId) as Record<string, unknown> | null;
      if (found) {
        const stored = valuesFromRow(found);
        if (JSON.stringify(stored) !== JSON.stringify(row.values))
          update.run(
            row.values.action,
            row.values.course,
            row.values.status,
            row.values.availability,
            row.values.weight,
            row.values.startBy,
            row.values.due,
            row.values.source,
            row.values.notes,
            row.values.archived ? 1 : 0,
            now,
            row.pageId,
          );
      } else {
        insert.run(
          randomUUID(),
          row.pageId,
          row.values.action,
          row.values.course,
          row.values.status,
          row.values.availability,
          row.values.weight,
          row.values.startBy,
          row.values.due,
          row.values.source,
          row.values.notes,
          row.values.archived ? 1 : 0,
          "imported",
          term,
          now,
          now,
        );
      }
      snapshot.run(row.pageId, JSON.stringify(row.values), now);
    }
    const missing = db
      .query("SELECT notion_page_id, values_json FROM notion_snapshot")
      .all() as Array<{ notion_page_id: string; values_json: string }>;
    for (const row of missing) {
      if (seen.has(row.notion_page_id)) continue;
      const before = JSON.parse(row.values_json) as ActionValues;
      const after = { ...before, archived: true };
      changed.push({ pageId: row.notion_page_id, before, after });
      if (!before.archived)
        db.query(
          "UPDATE actions SET archived=1, updated_at=? WHERE notion_page_id=? AND archived=0",
        ).run(now, row.notion_page_id);
      snapshot.run(row.notion_page_id, JSON.stringify(after), now);
    }
  })();
  return changed;
}

function valuesFromRow(row: Record<string, unknown>): ActionValues {
  return {
    action: String(row.action),
    course: String(row.course),
    status: row.status as ActionValues["status"],
    availability: row.availability as ActionValues["availability"],
    weight: row.weight === null ? null : Number(row.weight),
    startBy: row.start_by ? String(row.start_by) : null,
    due: row.due ? String(row.due) : null,
    source: row.source ? String(row.source) : null,
    notes: String(row.notes),
    archived: Boolean(row.archived),
  };
}

export function listActions(db: Database): Array<Action> {
  return (
    db.query("SELECT * FROM actions ORDER BY course, due, action").all() as Array<
      Record<string, unknown>
    >
  ).map((row) => ({
    id: String(row.id),
    notionPageId: row.notion_page_id ? String(row.notion_page_id) : null,
    action: String(row.action),
    course: String(row.course),
    status: row.status as Action["status"],
    availability: row.availability as Action["availability"],
    weight: row.weight === null ? null : Number(row.weight),
    startBy: row.start_by ? String(row.start_by) : null,
    due: row.due ? String(row.due) : null,
    source: row.source ? String(row.source) : null,
    notes: String(row.notes),
    archived: Boolean(row.archived),
    origin: row.origin as Action["origin"],
    term: String(row.term),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export function validatePlanner(db: Database, runId: string, courseCodes: Array<string>): void {
  const integrity = db.query("PRAGMA integrity_check").get() as { integrity_check: string };
  if (integrity.integrity_check !== "ok")
    throw new Error(`SQLite integrity failed: ${integrity.integrity_check}`);
  const scopes = new Set(
    (
      db
        .query("SELECT scope FROM agent_checks WHERE run_id=? AND result='complete'")
        .all(runId) as Array<{ scope: string }>
    ).map((row) => row.scope),
  );
  for (const scope of [...courseCodes, "all-courses"]) {
    if (!scopes.has(scope)) throw new Error(`Codex did not complete verification scope: ${scope}`);
  }
}
