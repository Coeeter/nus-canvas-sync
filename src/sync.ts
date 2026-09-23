import { copyFile, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sendFailureAlert } from "./alerts";
import { collectCanvas } from "./canvas";
import { reconcileWithCodex } from "./codex";
import { env, readSemester } from "./config";
import {
  importNotionRows,
  listActions,
  openPlanner,
  setContext,
  startRun,
  validatePlanner,
} from "./db";
import { assertNotionSchema, NotionClient, type NotionOperation, planNotionDiff } from "./notion";
import type { Action, NotionRow } from "./types";

export interface SyncOptions {
  collect?: boolean;
  reconcile?: boolean;
  publish?: boolean;
}

export async function sync(options: SyncOptions = {}): Promise<void> {
  const dataDir = process.env.DATA_DIR ?? "/data";
  const runId = new Date().toISOString().replace(/[-:.]/g, "");
  const workspace = join(dataDir, "runs", runId);
  const canonicalPath = join(dataDir, "planner.db");
  const workingPath = join(workspace, "planner.db");
  const lock = await acquireLock(join(dataDir, "sync.lock"));
  await mkdir(workspace, { recursive: true });
  try {
    const semester = await readSemester();
    const corpus =
      options.collect === false
        ? join(dataDir, "canvas", safeName(semester.term), "latest")
        : await collectCanvas(semester, dataDir, runId);
    if (await Bun.file(canonicalPath).exists()) await copyFile(canonicalPath, workingPath);
    const db = openPlanner(workingPath);
    const startedAt = new Date().toISOString();
    startRun(db, runId, startedAt);
    const notion = notionClient();
    if (notion) assertNotionSchema(await notion.schema());
    const notionRows = await readNotion(notion);
    const changes = importNotionRows(db, notionRows, semester.term, startedAt);
    const importedActions = listActions(db);
    const userChanges = renderUserChanges(changes);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();

    if (options.reconcile !== false) {
      await reconcileWithCodex({
        runId,
        workspace,
        database: workingPath,
        corpus,
        semester,
        userChanges,
      });
    }
    const checked = openPlanner(workingPath);
    if (options.reconcile !== false) {
      assertPreservedUserState(importedActions, listActions(checked));
      validatePlanner(
        checked,
        runId,
        semester.courses.map((course) => course.code),
      );
    }
    checked.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    checked.close();

    await promote(workingPath, canonicalPath);
    const canonical = openPlanner(canonicalPath);
    setContext(canonical, runId, "publisher");
    const operations = planNotionDiff(listActions(canonical), notionRows);
    canonical
      .query(
        "UPDATE runs SET status='pending_publish', final_hash=?, notion_diff_json=? WHERE id=?",
      )
      .run(await fileHash(canonicalPath), JSON.stringify(operations), runId);
    canonical.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    canonical.close();
    await Bun.write(join(workspace, "notion-diff.json"), JSON.stringify(operations, null, 2));

    if (options.publish && notion)
      await publish(notion, canonicalPath, runId, operations, semester);
    else
      console.log(
        JSON.stringify({
          event: "sync_pending_publish",
          runId,
          operations: operations.length,
          diff: join(workspace, "notion-diff.json"),
        }),
      );
  } catch (error) {
    await recordFailure(workingPath, canonicalPath, runId, error);
    console.error(JSON.stringify({ event: "sync_failed", runId, error: safeError(error) }));
    if (options.publish) {
      try {
        const notion = notionClient();
        if (notion) {
          const semester = await readSemester();
          await notion.updateSyncStatus(
            semester.dashboard.syncStatusBlockId,
            `Sync failed on ${formatSyncTime(new Date(), semester.timezone)}. Check the run before relying on the planner.`,
            "⚠️",
          );
        }
      } catch (statusError) {
        console.error(
          JSON.stringify({ event: "sync_status_update_failed", error: safeError(statusError) }),
        );
      }
    }
    try {
      await sendFailureAlert(runId, error);
    } catch (alertError) {
      console.error(
        JSON.stringify({ event: "failure_alert_failed", runId, error: safeError(alertError) }),
      );
    }
    throw error;
  } finally {
    await lock.close();
    await rm(join(dataDir, "sync.lock"), { force: true });
  }
}

export function assertPreservedUserState(before: Array<Action>, after: Array<Action>): void {
  const afterById = new Map(after.map((action) => [action.id, action]));
  for (const action of before) {
    const current = afterById.get(action.id);
    if (!current)
      throw new Error(
        `Reconciliation removed existing planner row: ${action.course} ${action.action}`,
      );
    if (current.status !== action.status)
      throw new Error(
        `Reconciliation changed user-owned Status for ${action.course} ${action.action}: ${action.status} -> ${current.status}`,
      );
    if (action.archived && !current.archived)
      throw new Error(
        `Reconciliation revived a user-archived planner row: ${action.course} ${action.action}`,
      );
  }
}

async function recordFailure(
  workingPath: string,
  canonicalPath: string,
  runId: string,
  error: unknown,
): Promise<void> {
  const path = (await Bun.file(workingPath).exists()) ? workingPath : canonicalPath;
  if (!(await Bun.file(path).exists())) return;
  try {
    const db = openPlanner(path);
    db.query("UPDATE runs SET status='failed', finished_at=?, error=? WHERE id=?").run(
      new Date().toISOString(),
      safeError(error).slice(0, 2000),
      runId,
    );
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
  } catch {}
}

async function publish(
  client: NotionClient,
  dbPath: string,
  runId: string,
  operations: Array<NotionOperation>,
  semester: Awaited<ReturnType<typeof readSemester>>,
): Promise<void> {
  const db = openPlanner(dbPath);
  setContext(db, runId, "publisher");
  for (const operation of operations) {
    if (operation.type === "create") {
      const pageId = await client.create(operation.values);
      db.query("UPDATE actions SET notion_page_id=?, updated_at=? WHERE id=?").run(
        pageId,
        new Date().toISOString(),
        operation.actionId,
      );
    } else {
      await client.update(operation.pageId!, operation.values);
    }
  }
  const actual = await client.queryRows();
  const remaining = planNotionDiff(listActions(db), actual);
  if (remaining.length > 0)
    throw new Error(`Notion verification left ${remaining.length} operation(s)`);
  const capturedAt = new Date().toISOString();
  await client.updateSyncStatus(
    semester.dashboard.syncStatusBlockId,
    `All ${semester.courses.length} courses successfully synced on ${formatSyncTime(new Date(capturedAt), semester.timezone)}.`,
    "✅",
  );
  db.transaction(() => {
    db.exec("DELETE FROM notion_snapshot");
    const insert = db.query(
      "INSERT INTO notion_snapshot(notion_page_id,values_json,captured_at) VALUES (?,?,?)",
    );
    for (const row of actual) insert.run(row.pageId, JSON.stringify(row.values), capturedAt);
    db.query(
      "UPDATE runs SET status='success', finished_at=?, notion_diff_json='[]' WHERE id=?",
    ).run(capturedAt, runId);
  })();
  db.close();
  console.log(JSON.stringify({ event: "sync_finished", runId, operations: operations.length }));
}

export function formatSyncTime(date: Date, timezone: string): string {
  return `${new Intl.DateTimeFormat("en-SG", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date)} (${timezone})`;
}

function notionClient(): NotionClient | null {
  if (process.env.NOTION_FIXTURE_PATH) return null;
  const token = process.env.NOTION_TOKEN;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;
  if (!token || !dataSourceId) return null;
  return new NotionClient(token, dataSourceId.replace("collection://", ""));
}

async function readNotion(client: NotionClient | null): Promise<Array<NotionRow>> {
  if (process.env.NOTION_FIXTURE_PATH)
    return (await Bun.file(env("NOTION_FIXTURE_PATH")).json()) as Array<NotionRow>;
  if (!client) throw new Error("Notion configuration is required");
  return client.queryRows();
}

async function acquireLock(path: string) {
  await mkdir(dirname(path), { recursive: true });
  try {
    return await open(path, "wx");
  } catch {
    throw new Error("Another sync is already running");
  }
}

async function promote(source: string, destination: string): Promise<void> {
  const previous = `${destination}.previous`;
  await rm(previous, { force: true });
  try {
    await rename(destination, previous);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(source, destination);
  } catch (error) {
    try {
      await rename(previous, destination);
    } catch {}
    throw error;
  }
  await rm(previous, { force: true });
}

function renderUserChanges(changes: ReturnType<typeof importNotionRows>): string {
  if (changes.length === 0) return "# User changes since last sync\n\nNone.\n";
  return `# User changes since last sync\n\n${changes.map((change) => `## ${change.pageId}\n\nBefore: ${JSON.stringify(change.before)}\n\nAfter: ${JSON.stringify(change.after)}`).join("\n\n")}`;
}

async function fileHash(path: string): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
}
function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "term";
}
function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /(token|authorization|bearer)(\s*[:=]?\s*)\S+/gi,
    "$1$2[REDACTED]",
  );
}
