import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import type { CodexExecutor } from "../../src/ai/interpret";
import { buildCodexArgs, interpretCourse, sanitizeStderr } from "../../src/ai/interpret";
import type { NormalizedRecord } from "../../src/normalize/types";

const record = {
  id: "course:1:announcement:2",
  courseCode: "IS1128",
  kind: "announcement",
  sourceUrl: null,
  contentHash: "x",
  fields: { message: "Quiz announced" },
} satisfies NormalizedRecord;

test("keeps large prompts out of Codex argv", () => {
  const prompt = "x".repeat(200_000);
  const args = buildCodexArgs("/tmp/schema.json", "/tmp/output.json", "/tmp/work");

  expect(args).not.toContain(prompt);
  expect(args.at(-1)).toBe("-");
});

test("redacts credentials and bounds Codex stderr", () => {
  const stderr =
    "Bearer secret-token https://example.test/a?token=canvas-secret&verifier=canvas-verifier " +
    "x".repeat(1_000);
  const redacted = sanitizeStderr(stderr);
  const bounded = sanitizeStderr(stderr, 100);

  expect(redacted).not.toContain("secret-token");
  expect(redacted).not.toContain("canvas-secret");
  expect(redacted).not.toContain("canvas-verifier");
  expect(redacted).toContain("Bearer [REDACTED]");
  expect(bounded.startsWith("[truncated] ...")).toBe(true);
  expect(bounded.endsWith("x".repeat(100))).toBe(true);
});

test("does not invoke Codex when there is no semantic change", async () => {
  let calls = 0;
  const executor: CodexExecutor = {
    execute: () => {
      calls += 1;
      return Effect.void;
    },
  };
  expect(
    await Effect.runPromise(
      interpretCourse(
        { courseCode: "IS1128", courseContext: "", changedRecords: [], referencedDocuments: [] },
        "",
        "{}",
        executor,
      ).pipe(Effect.provide(BunServices.layer)),
    ),
  ).toEqual({ candidates: [] });
  expect(calls).toBe(0);
});

test("retries once and rejects unsupported provenance", async () => {
  let calls = 0;
  const prompts: Array<string> = [];
  const executor: CodexExecutor = {
    execute: (prompt, _schema, output) =>
      Effect.sync(() => {
        calls += 1;
        prompts.push(prompt);
        const sourceIds = calls === 1 ? ["invented"] : [record.id];
        writeFileSync(
          output,
          JSON.stringify({
            candidates: [
              {
                courseCode: "IS1128",
                sourceIds,
                evidence: "Quiz announced",
                kind: "assessment",
                title: "Quiz",
                requiredAction: "Attempt",
                availableFrom: null,
                dueAt: null,
                eventEndsAt: null,
                confidence: 0.9,
                ambiguity: null,
              },
            ],
          }),
        );
      }),
  };
  const result = await Effect.runPromise(
    interpretCourse(
      {
        courseCode: "IS1128",
        courseContext: "only",
        changedRecords: [record],
        referencedDocuments: [],
      },
      "rules",
      "{}",
      executor,
    ).pipe(Effect.provide(BunServices.layer)),
  );
  expect(calls).toBe(2);
  expect(prompts[1]).toContain("candidate cites an unavailable source identity");
  expect(result.candidates[0]?.sourceIds).toEqual([record.id]);
});
