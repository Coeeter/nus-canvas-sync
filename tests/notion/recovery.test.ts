import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect, type Layer } from "effect";
import { NotionClient } from "../../src/notion/client";
import { notionServer } from "../support/notion-server";

const create = {
  type: "create",
  identity: "course:97325:assignment:1",
  properties: {
    "Canvas Item ID": "course:97325:assignment:1",
    Readiness: "Ready",
    Status: "Not started",
  },
} as const;
const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof BunServices.layer>>) =>
  Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));

test("committed create with a 500 response is recovered with exactly one POST", async () => {
  const server = notionServer();
  server.commitThenFail = true;
  const client = new NotionClient("fixture", "fixture", server.http);
  const saved = await run(client.applyAndVerify(create));
  expect(saved.id).toBe("page-1");
  expect(server.creates).toBe(1);
});

test("unresolved create intent prevents another POST after client restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nus-pending-"));
  try {
    const server = notionServer();
    server.failBeforeCreate = true;
    await expect(
      run(new NotionClient("fixture", "fixture", server.http, dir).applyAndVerify(create)),
    ).rejects.toThrow();
    server.failBeforeCreate = false;
    await expect(
      run(new NotionClient("fixture", "fixture", server.http, dir).applyAndVerify(create)),
    ).rejects.toThrow("unresolved create intent");
    expect(server.creates).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verification rejects a correct identity with missing Readiness", async () => {
  const server = notionServer();
  server.omitSavedProperty = "Readiness";
  await expect(
    run(new NotionClient("fixture", "fixture", server.http).applyAndVerify(create)),
  ).rejects.toThrow("saved properties differ");
});

test("refetch preserves terminal choices, pinned plans, notes and rejects lost ownership", async () => {
  const server = notionServer();
  const client = new NotionClient("fixture", "fixture", server.http);
  server.put("existing", {
    ...create.properties,
    Status: "Dropped",
    Pinned: true,
    Planned: "2026-09-09",
    Notes: "My own notes",
  });
  await run(
    client.applyAndVerify({
      type: "update",
      pageId: "existing",
      identity: create.identity,
      properties: { ...create.properties, Status: "Done", Planned: "2026-09-10" },
      managedNotes: "Required reading",
    }),
  );
  expect(server.values()[0]?.properties).toMatchObject({
    Status: "Dropped",
    Planned: "2026-09-09",
    Readiness: "Later",
    Notes: expect.stringContaining("My own notes"),
  });
  server.put("existing", { "Canvas Item ID": "", Notes: "manual now" });
  await expect(
    run(
      client.applyAndVerify({
        type: "update",
        pageId: "existing",
        identity: create.identity,
        properties: create.properties,
      }),
    ),
  ).rejects.toThrow("ownership changed");
  expect(server.values()[0]?.properties.Notes).toBe("manual now");
});
