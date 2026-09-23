import { collectCanvas } from "./canvas";
import { env, readSemester } from "./config";
import { NotionClient, planNotionSchema } from "./notion";
import { sync } from "./sync";

const command = process.argv[2] ?? "sync";
if (command === "sync")
  await sync({
    collect: !process.argv.includes("--no-collect"),
    reconcile: !process.argv.includes("--no-reconcile"),
    publish: process.argv.includes("--publish"),
  });
else if (command === "collect") {
  const runId = new Date().toISOString().replace(/[-:.]/g, "");
  console.log(
    JSON.stringify({
      event: "canvas_collection_finished",
      corpus: await collectCanvas(await readSemester(), process.env.DATA_DIR ?? "/data", runId),
      runId,
    }),
  );
} else if (command === "notion-schema") {
  console.log(
    JSON.stringify(
      planNotionSchema(
        await new NotionClient(
          env("NOTION_TOKEN"),
          env("NOTION_DATA_SOURCE_ID").replace("collection://", ""),
        ).schema(),
      ),
      null,
      2,
    ),
  );
} else if (command === "notion-export") {
  const destination = process.argv[3] ?? "/data/notion-backup.json";
  const client = new NotionClient(
    env("NOTION_TOKEN"),
    env("NOTION_DATA_SOURCE_ID").replace("collection://", ""),
  );
  await Bun.write(destination, JSON.stringify(await client.exportRaw(), null, 2));
  console.log(JSON.stringify({ event: "notion_export_finished", destination }));
} else if (command === "notion-schema-add") {
  const client = new NotionClient(
    env("NOTION_TOKEN"),
    env("NOTION_DATA_SOURCE_ID").replace("collection://", ""),
  );
  await client.addDesiredProperties();
  console.log(JSON.stringify({ event: "notion_schema_fields_added" }));
} else if (command === "notion-schema-remove") {
  const client = new NotionClient(
    env("NOTION_TOKEN"),
    env("NOTION_DATA_SOURCE_ID").replace("collection://", ""),
  );
  const plan = planNotionSchema(await client.schema());
  await client.removeProperties(plan.remove);
  console.log(JSON.stringify({ event: "notion_schema_fields_removed", count: plan.remove.length }));
} else if (command === "healthcheck") {
  const tools = await Promise.all(
    [
      ["canvas", "--version"],
      ["codex", "--version"],
      ["codex-code-mode-host", "--help"],
      ["sqlite3", "--version"],
      ["pdftotext", "-v"],
    ].map(async ([tool, versionFlag]) => {
      const process = Bun.spawn([tool!, versionFlag!], { stdout: "pipe", stderr: "pipe" });
      return { tool, ok: (await process.exited) === 0 };
    }),
  );
  if (tools.some((tool) => !tool.ok)) process.exitCode = 1;
  console.log(JSON.stringify({ ok: process.exitCode !== 1, tools }));
} else throw new Error(`Unknown command: ${command}`);
