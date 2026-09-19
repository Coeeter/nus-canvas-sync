import { planMigration } from "../reconcile/migration";
import type { ExistingAction } from "../reconcile/plan";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: bun run migration:dry-run -- <sanitized-notion-rows.json>");
  process.exit(2);
}
const rows = await Bun.file(inputPath).json();
const existing: Array<ExistingAction> = rows.map((row: Record<string, unknown>) => ({
  id: String(row.url).split("/").at(-1),
  automatedIdentity: typeof row["Canvas Item ID"] === "string" ? row["Canvas Item ID"] : null,
  properties: Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/^date:(.*):start$/, "$1"),
      value === "__YES__" ? true : value === "__NO__" ? false : value,
    ]),
  ),
}));
console.log(JSON.stringify(planMigration(existing), null, 2));
