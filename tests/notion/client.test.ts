import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { NotionClient } from "../../src/notion/client";
import { encodeNotionProperties } from "../../src/notion/properties";
import { planReconciliation } from "../../src/reconcile/plan";
import { stateAfterVerifiedWrites } from "../../src/reconcile/state";
import { projectTask } from "../../src/rules/lifecycle";
import { emptyReconciliationState } from "../../src/state/reconcile-store";

test("queries the configured data source without exposing the token in the URL", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const httpClient = HttpClient.make((request, url) => {
    calls.push({ url: String(url), init: { headers: request.headers } });
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }), {
          status: 200,
        }),
      ),
    );
  });
  const client = new NotionClient("secret-token", "source-id", httpClient);
  expect(await Effect.runPromise(client.queryActions())).toEqual([]);
  expect(calls[0]?.url).toEndWith("/v1/data_sources/source-id/query");
  expect(calls[0]?.url).not.toContain("secret-token");
});

test("refetches and rebases an update so an intervening user date edit is preserved", async () => {
  const current = {
    "Canvas Item ID": "old-id",
    Readiness: "Review",
    "Needs Review": true,
    "Official Due": "2026-10-01T02:00:00Z",
    Status: "Not started",
  } as Record<string, unknown>;
  const patchBodies: Array<Record<string, unknown>> = [];
  const page = () => ({
    id: "page",
    properties: Object.fromEntries(
      Object.entries(encodeNotionProperties(current)).map(([name, property]) => {
        const value = property as Record<string, unknown>;
        if ("rich_text" in value) {
          return [
            name,
            { rich_text: [{ plain_text: current[name] == null ? "" : String(current[name]) }] },
          ];
        }
        return [name, property];
      }),
    ),
  });
  const httpClient = HttpClient.make((request, url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/pages/page" && request.method === "PATCH") {
      const body = JSON.parse(
        new TextDecoder().decode((request.body as { body: Uint8Array }).body),
      ) as { properties: Record<string, unknown> };
      patchBodies.push(body.properties);
      Object.assign(current, requireDecoded(body.properties));
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify({ id: "page" }), { status: 200 }),
        ),
      );
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(JSON.stringify(page()), { status: 200 })),
    );
  });
  const client = new NotionClient("secret-token", "source-id", httpClient);
  const result = await Effect.runPromise(
    client.applyAndVerify({
      type: "update",
      pageId: "page",
      identity: "new-id",
      properties: {
        "Canvas Item ID": "new-id",
        Readiness: "Ready",
        "Needs Review": false,
        "Official Due": "2026-09-30T02:00:00Z",
      },
      expectedProperties: {
        "Canvas Item ID": "old-id",
        Readiness: "Review",
        "Needs Review": true,
        "Official Due": null,
      },
    }),
  );
  expect(patchBodies).toHaveLength(1);
  expect(patchBodies[0]).not.toHaveProperty("Official Due");
  expect(result.properties["Official Due"]).toBe("2026-10-01T02:00:00Z");
  expect(result.automatedIdentity).toBe("new-id");
});

test("checks the identity precondition before patching a row that became manual", async () => {
  const current = { "Canvas Item ID": null, Readiness: "Review", "Needs Review": true } as Record<
    string,
    unknown
  >;
  let patches = 0;
  const httpClient = HttpClient.make((request, _url) => {
    if (request.method === "PATCH") patches += 1;
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(pageFor(current)), { status: 200 }),
      ),
    );
  });
  const result = await Effect.runPromiseExit(
    new NotionClient("secret-token", "source-id", httpClient).applyAndVerify({
      type: "update",
      pageId: "page",
      identity: "task-id",
      properties: { Readiness: "Ready", "Needs Review": false },
      expectedProperties: { "Canvas Item ID": "task-id", Readiness: "Review" },
    }),
  );
  expect(result._tag).toBe("Failure");
  expect(patches).toBe(0);
});

test("does not overwrite a terminal status with a stale lifecycle patch", async () => {
  const current = {
    "Canvas Item ID": "task-id",
    Readiness: "Review",
    "Needs Review": true,
    Status: "Done",
  } as Record<string, unknown>;
  let patches = 0;
  const httpClient = HttpClient.make((request, _url) => {
    if (request.method === "PATCH") patches += 1;
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(pageFor(current)), { status: 200 }),
      ),
    );
  });
  const result = await Effect.runPromiseExit(
    new NotionClient("secret-token", "source-id", httpClient).applyAndVerify({
      type: "update",
      pageId: "page",
      identity: "task-id",
      properties: { Readiness: "Ready", "Needs Review": false },
      expectedProperties: {
        "Canvas Item ID": "task-id",
        Readiness: "Review",
        "Needs Review": true,
        Status: "Not started",
      },
    }),
  );
  expect(result._tag).toBe("Failure");
  expect(patches).toBe(0);
});

test("a terminal row planned as terminal accepts safe identity and completion metadata", async () => {
  const current = {
    "Canvas Item ID": "legacy-task",
    Readiness: "Review",
    "Needs Review": true,
    Status: "Done",
  } as Record<string, unknown>;
  let patches = 0;
  const httpClient = HttpClient.make((request, _url) => {
    if (request.method === "PATCH") {
      patches += 1;
      const body = JSON.parse(
        new TextDecoder().decode((request.body as { body: Uint8Array }).body),
      ) as { properties: Record<string, unknown> };
      Object.assign(current, requireDecoded(body.properties));
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(pageFor(current)), { status: 200 }),
      ),
    );
  });
  const result = await Effect.runPromise(
    new NotionClient("secret-token", "source-id", httpClient).applyAndVerify({
      type: "update",
      pageId: "page",
      identity: "canonical-task",
      properties: {
        "Canvas Item ID": "canonical-task",
        Readiness: "Completed",
        "Needs Review": false,
      },
      expectedProperties: {
        "Canvas Item ID": "legacy-task",
        Readiness: "Review",
        "Needs Review": true,
        Status: "Done",
      },
    }),
  );
  expect(patches).toBe(1);
  expect(result.properties["Canvas Item ID"]).toBe("canonical-task");
  expect(result.properties.Status).toBe("Done");
  expect(result.properties.Readiness).toBe("Completed");
});

test("terminal plan, client, and state sequence preserves completion and migrates identity", async () => {
  const projection = projectTask(
    {
      id: "canonical-task",
      courseCode: "IS1128",
      kind: "assessment",
      title: "Project",
      sourceIds: ["course:97325:assignment:123"],
      aliases: ["legacy-task"],
      observed: true,
      authoritativeAction: true,
      userStatus: "Done",
    },
    new Date("2026-09-19T09:00:00Z"),
  );
  const existing = [
    {
      id: "page",
      automatedIdentity: "legacy-task",
      properties: {
        "Canvas Item ID": "legacy-task",
        Status: "Done",
        Readiness: "Review",
        "Needs Review": true,
      },
    },
  ];
  const [operation] = planReconciliation(existing, [projection], "2026-09-19T09:00:00.000Z");
  expect(operation?.type).toBe("update");
  if (operation?.type !== "update") throw new Error("expected terminal update");

  const current = { ...existing[0]!.properties };
  let patches = 0;
  const httpClient = HttpClient.make((request, _url) => {
    if (request.method === "PATCH") {
      patches += 1;
      const body = JSON.parse(
        new TextDecoder().decode((request.body as { body: Uint8Array }).body),
      ) as { properties: Record<string, unknown> };
      Object.assign(current, requireDecoded(body.properties));
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify({ id: "page", properties: pageFor(current)!.properties }), {
          status: 200,
        }),
      ),
    );
  });
  const verified = await Effect.runPromise(
    new NotionClient("secret-token", "source-id", httpClient).applyAndVerify(operation),
  );
  const saved = stateAfterVerifiedWrites(
    emptyReconciliationState(),
    [verified],
    [projection],
    [operation],
  );
  expect(patches).toBe(1);
  expect(verified.automatedIdentity).toBe("canonical-task");
  expect(verified.properties.Status).toBe("Done");
  expect(verified.properties.Readiness).toBe("Completed");
  expect(saved.tasks[projection.id]?.lastWritten["Canvas Item ID"]).toBe("canonical-task");
  expect(saved.tasks[projection.id]?.lastWritten.Readiness).toBe("Completed");
});

test("verifies equivalent Notion date representations as the same instant", async () => {
  const current = { "Canvas Item ID": "task-id", "Official Due": null } as Record<string, unknown>;
  let patches = 0;
  const httpClient = HttpClient.make((request, _url) => {
    if (request.method === "PATCH") {
      patches += 1;
      const body = JSON.parse(
        new TextDecoder().decode((request.body as { body: Uint8Array }).body),
      ) as { properties: Record<string, unknown> };
      Object.assign(current, requireDecoded(body.properties));
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(pageFor(current, true)), { status: 200 }),
      ),
    );
  });
  const result = await Effect.runPromise(
    new NotionClient("secret-token", "source-id", httpClient).applyAndVerify({
      type: "update",
      pageId: "page",
      identity: "task-id",
      properties: { "Official Due": "2026-09-30T02:00:00Z" },
      expectedProperties: { "Canvas Item ID": "task-id", "Official Due": null },
    }),
  );
  expect(result.properties["Official Due"]).toBe("2026-09-30T02:00:00.000+00:00");
  expect(patches).toBe(1);
});

function pageFor(current: Record<string, unknown>, normalizeDates = false) {
  const properties = encodeNotionProperties(current);
  for (const value of Object.values(properties)) {
    const property = value as Record<string, unknown>;
    if (property.rich_text) {
      property.rich_text = (property.rich_text as Array<{ text: { content: string } }>).map(
        (part) => ({ plain_text: part.text.content }),
      );
    }
    if (property.title) {
      property.title = (property.title as Array<{ text: { content: string } }>).map((part) => ({
        plain_text: part.text.content,
      }));
    }
    if (normalizeDates && property.date && typeof property.date === "object") {
      const date = property.date as { start?: string | null };
      if (date.start) date.start = new Date(date.start).toISOString().replace(/Z$/, "+00:00");
    }
  }
  return { id: "page", properties };
}

function requireDecoded(properties: Record<string, unknown>) {
  const decoded: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(properties)) {
    const value = property as Record<string, unknown>;
    if ("rich_text" in value)
      decoded[name] =
        (value.rich_text as Array<{ text?: { content?: string } }>)[0]?.text?.content ?? null;
    else if ("select" in value)
      decoded[name] = (value.select as { name?: string } | null)?.name ?? null;
    else if ("checkbox" in value) decoded[name] = value.checkbox;
    else if ("date" in value)
      decoded[name] = (value.date as { start?: string } | null)?.start ?? null;
  }
  return decoded;
}
