import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import type { CodexExecutor } from "../../src/ai/interpret";
import { buildCodexArgs, interpretCourse, sanitizeStderr } from "../../src/ai/interpret";
import { candidateToFact } from "../../src/ai/reduce";
import { validateCandidates } from "../../src/ai/validate";
import type { NormalizedRecord } from "../../src/normalize/types";

const record = {
  id: "course:1:announcement:2",
  courseCode: "IS1128",
  kind: "announcement",
  sourceUrl: null,
  contentHash: "x",
  fields: { message: "Quiz" },
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
  const executor: CodexExecutor = {
    execute: (_prompt, _schema, output) =>
      Effect.sync(() => {
        calls += 1;
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
                dateEvidence: {
                  availableFrom: { state: "unknown", value: null, sourceIds: [record.id] },
                  dueAt: { state: "unknown", value: null, sourceIds: [record.id] },
                  eventEndsAt: { state: "unknown", value: null, sourceIds: [record.id] },
                },
                confidence: 0.9,
                ambiguity: null,
                reviewIssue: null,
                matchTaskId: null,
                logicalKey: null,
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
  expect(result.candidates[0]?.sourceIds).toEqual([record.id]);
});

function candidateWithDates(overrides: Record<string, unknown> = {}) {
  return {
    courseCode: "IS1128",
    sourceIds: [record.id],
    evidence: "The source describes the project proposal.",
    kind: "assessment",
    title: "Project proposal",
    requiredAction: "Submit",
    availableFrom: null,
    dueAt: null,
    eventEndsAt: null,
    dateEvidence: {
      availableFrom: { state: "unknown", value: null, sourceIds: [record.id] },
      dueAt: { state: "unknown", value: null, sourceIds: [record.id] },
      eventEndsAt: { state: "unknown", value: null, sourceIds: [record.id] },
    },
    confidence: 0.95,
    ambiguity: null,
    reviewIssue: null,
    matchTaskId: null,
    logicalKey: null,
    ...overrides,
  };
}

test("machine date validation accepts ISO date-only and timezone-bearing timestamps", () => {
  const valid = candidateWithDates({
    dueAt: "2026-09-30",
    dateEvidence: {
      availableFrom: { state: "unknown", value: null, sourceIds: [record.id] },
      dueAt: { state: "value", value: "2026-09-30", sourceIds: [record.id] },
      eventEndsAt: { state: "unknown", value: null, sourceIds: [record.id] },
    },
  });
  const timestamp = candidateWithDates({
    dueAt: "2026-09-30T23:59:00+08:00",
    dateEvidence: {
      availableFrom: { state: "unknown", value: null, sourceIds: [record.id] },
      dueAt: { state: "value", value: "2026-09-30T23:59:00+08:00", sourceIds: [record.id] },
      eventEndsAt: { state: "unknown", value: null, sourceIds: [record.id] },
    },
  });
  expect(
    validateCandidates({ candidates: [valid] }, "IS1128", new Set([record.id])).candidates[0]
      ?.dueAt,
  ).toBe("2026-09-30");
  expect(
    validateCandidates({ candidates: [timestamp] }, "IS1128", new Set([record.id])).candidates[0]
      ?.dueAt,
  ).toBe("2026-09-30T23:59:00+08:00");
});

test("malformed machine dates fail validation while raw incomplete evidence remains review text", () => {
  for (const dueAt of ["2026-02-30", "2026-09-30T02:00:00", "September 30"]) {
    const malformed = candidateWithDates({
      dueAt,
      dateEvidence: {
        availableFrom: { state: "unknown", value: null, sourceIds: [record.id] },
        dueAt: { state: "value", value: dueAt, sourceIds: [record.id] },
        eventEndsAt: { state: "unknown", value: null, sourceIds: [record.id] },
      },
    });
    expect(() =>
      validateCandidates({ candidates: [malformed] }, "IS1128", new Set([record.id])),
    ).toThrow();
  }

  const incomplete = candidateWithDates({
    reviewIssue: {
      kind: "ambiguous-evidence",
      fields: ["dueAt"],
      values: [{ field: "dueAt", sourceId: record.id, state: "value", value: "September 30" }],
    },
  });
  const validated = validateCandidates(
    { candidates: [incomplete] },
    "IS1128",
    new Set([record.id]),
  );
  const fact = candidateToFact(validated.candidates[0]!);
  expect(fact).not.toHaveProperty("dueAt");
  expect(fact.conflict?.issue?.values).toContainEqual(
    expect.objectContaining({ field: "dueAt", value: "September 30" }),
  );
});
