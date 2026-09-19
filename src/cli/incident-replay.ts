import type { CandidateEnvelope } from "../ai/types";
import type { NormalizedRecord } from "../normalize/types";
import type { ExistingAction, ReconcileOperation } from "../reconcile/plan";
import { planCourse } from "../run/course-plan";
import { emptyReconciliationState } from "../state/reconcile-store";

const inputDir = process.argv[2];
if (!inputDir) {
  console.error("Usage: bun run incident:replay -- <captured-data-dir>");
  process.exit(2);
}

const notionRows = (await Bun.file(`${inputDir}/notion-rows.json`).json()) as Array<
  Record<string, unknown>
>;
const existing = notionRows.map(toExistingAction);
const now = new Date("2026-09-19T09:00:00Z");

const output: Record<string, unknown> = {
  inputDir,
  writesPerformed: false,
  courses: {},
};

for (const code of ["IS1128", "GEA1000"] as const) {
  const records = (await Bun.file(
    `${inputDir}/${code}-baseline.json`,
  ).json()) as Array<NormalizedRecord>;
  const candidates = (await Bun.file(
    `${inputDir}/${code}-candidates.json`,
  ).json()) as CandidateEnvelope;
  const plan = planCourse({
    records,
    candidates,
    existing,
    reconciliationState: emptyReconciliationState(),
    now,
    syncedAt: now.toISOString(),
  });
  const resultingRows = structuredClone(existing);
  applyOperations(resultingRows, plan.operations);
  const terminalRows = resultingRows
    .filter((row) => row.properties.Status === "Done" || row.properties.Status === "Dropped")
    .map(summarizeTerminalRow);
  const terminalReviewViolations = terminalRows.filter(
    (row) => row.needsReview === true || row.readiness === "Review",
  );
  if (terminalReviewViolations.length > 0) {
    throw new Error(
      `terminal replay routed rows to review: ${terminalReviewViolations.map((row) => row.id).join(", ")}`,
    );
  }
  (output.courses as Record<string, unknown>)[code] = {
    recordCount: records.length,
    candidateCount: candidates.candidates.length,
    projections: plan.projections.map((projection) => ({
      id: projection.id,
      kind: projection.kind,
      title: projection.title,
      state: projection.state,
      needsReview: projection.needsReview,
      availableFrom: projection.availableFrom,
      dueAt: projection.dueAt,
      sourceIds: projection.sourceIds,
    })),
    operations: plan.operations.map(summarizeOperation),
    conflicts: plan.conflicts,
    terminalRows,
  };
}

console.log(JSON.stringify(output, null, 2));

function toExistingAction(row: Record<string, unknown>): ExistingAction {
  const url = typeof row.url === "string" ? row.url : "";
  return {
    id: url.split("/").at(-1) ?? "unknown-page",
    automatedIdentity: typeof row["Canvas Item ID"] === "string" ? row["Canvas Item ID"] : null,
    properties: Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/^date:(.*):start$/, "$1"),
        value === "__YES__" ? true : value === "__NO__" ? false : value,
      ]),
    ),
  };
}

function summarizeOperation(operation: ReconcileOperation) {
  if (operation.type === "create") {
    return {
      type: operation.type,
      identity: operation.identity,
      properties: operation.properties,
    };
  }
  return {
    type: operation.type,
    pageId: operation.pageId,
    identity: operation.identity,
    properties: operation.properties,
    expectedProperties: operation.expectedProperties,
  };
}

function applyOperations(
  rows: Array<ExistingAction>,
  operations: ReadonlyArray<ReconcileOperation>,
) {
  for (const operation of operations) {
    if (operation.type === "create") {
      rows.push({
        id: `replay-created-${rows.length}`,
        automatedIdentity: operation.identity,
        properties: { ...operation.properties },
      });
      continue;
    }
    const row = rows.find((candidate) => candidate.id === operation.pageId);
    if (!row) throw new Error(`replay operation references missing page ${operation.pageId}`);
    Object.assign(row.properties, operation.properties);
    row.automatedIdentity = operation.identity;
  }
}

function summarizeTerminalRow(row: ExistingAction) {
  return {
    id: row.id,
    identity: row.automatedIdentity,
    status: row.properties.Status,
    readiness: row.properties.Readiness,
    needsReview: row.properties["Needs Review"],
    officialDue: row.properties["Official Due"],
    availableFrom: row.properties["Available From"],
  };
}
