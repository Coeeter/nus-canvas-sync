import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SemesterConfig } from "./types";

export async function reconcileWithCodex(input: {
  runId: string;
  workspace: string;
  database: string;
  corpus: string;
  semester: SemesterConfig;
  userChanges: string;
}): Promise<string> {
  await mkdir(input.workspace, { recursive: true });
  const transcript = join(input.workspace, "codex-transcript.jsonl");
  const lastMessage = join(input.workspace, "codex-last-message.txt");
  await Bun.write(join(input.workspace, "USER_CHANGES.md"), input.userChanges);
  await Bun.write(
    join(input.workspace, "PLANNER_GUIDE.md"),
    await Bun.file("docs/planner-guide.md").text(),
  );
  await Bun.write(
    join(input.workspace, "SYNC_INSTRUCTIONS.md"),
    await Bun.file("docs/sync-agent.md").text(),
  );
  await Bun.write(join(input.workspace, "SEMESTER.json"), JSON.stringify(input.semester, null, 2));

  const prompt = [
    "Reconcile the complete university planner now.",
    "Read PLANNER_GUIDE.md, SYNC_INSTRUCTIONS.md, SEMESTER.json, and USER_CHANGES.md completely.",
    `The SQLite database is ${input.database}.`,
    `The latest Canvas corpus is ${input.corpus}.`,
    `This run id is ${input.runId}.`,
    "Before editing actions, run: sqlite3 \"$PLANNER_DB\" \"UPDATE runtime_context SET run_id='$PLANNER_RUN_ID', actor='codex' WHERE singleton=1;\"",
    "Use sqlite3 directly and leave the database as the complete desired planner. Do not edit repository files.",
  ].join("\n");

  let lastError = "";
  for (const model of codexModels(process.env.CODEX_MODEL)) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const args = [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check",
        // The agent already runs as an unprivileged user inside the planner container.
        // Nested Linux namespaces are unavailable on ordinary Docker/Dokploy hosts.
        "--dangerously-bypass-approvals-and-sandbox",
        "--json",
        "--output-last-message",
        lastMessage,
      ];
      if (model) args.push("--model", model);
      if (process.env.CODEX_REASONING)
        args.push("-c", `model_reasoning_effort="${process.env.CODEX_REASONING}"`);
      args.push("--cd", input.workspace, "-");
      const child = Bun.spawn(["codex", ...args], {
        cwd: input.workspace,
        env: {
          ...stringEnv(),
          PLANNER_DB: input.database,
          PLANNER_RUN_ID: input.runId,
          CANVAS_CORPUS: input.corpus,
        },
        stdin: new Blob([prompt]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      await Bun.write(transcript, `${await safeExistingText(transcript)}${stdout}`);
      if (exitCode === 0) return transcript;
      lastError = redact(stderr.trim() || transcriptFailure(stdout));
      if (lastError.includes('"status":400') || lastError.includes("invalid_request_error")) break;
    }
    if (!isUnsupportedModel(lastError)) break;
    console.log(JSON.stringify({ event: "codex_model_unsupported", model }));
  }
  throw new Error(`Codex reconciliation failed: ${lastError}`);
}

export function codexModels(setting: string | undefined): Array<string | undefined> {
  const models = (setting ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return models.length > 0 ? models : [undefined];
}

// ChatGPT-account Codex rejects models the plan lacks with this 400, before doing any work.
export function isUnsupportedModel(error: string): boolean {
  return /model is not supported/i.test(error);
}

export function transcriptFailure(output: string): string {
  for (const line of output.trim().split("\n").reverse()) {
    try {
      const event = JSON.parse(line) as { type?: string; error?: { message?: string } };
      if (event.type === "turn.failed" && event.error?.message) return event.error.message;
    } catch {}
  }
  return "Codex exited without a reported error";
}

function stringEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

async function safeExistingText(path: string): Promise<string> {
  return (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
}

function redact(value: string): string {
  return value
    .replace(/(token|authorization|bearer)(\s*[:=]?\s*)\S+/gi, "$1$2[REDACTED]")
    .slice(-2000);
}
