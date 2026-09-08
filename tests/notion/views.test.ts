import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { NotionClient } from "../../src/notion/client";
import { PLANNER_VIEWS, plannerViewDefinitions } from "../../src/notion/views";

test("rolling planner filters advance with each sync", () => {
  const first = plannerViewDefinitions(new Date("2026-09-06T04:00:00Z"));
  const next = plannerViewDefinitions(new Date("2026-09-08T12:00:00Z"));

  expect(JSON.stringify(first.urgent.filter)).toContain('"on_or_before":"2026-09-09"');
  expect(JSON.stringify(next.urgent.filter)).toContain('"on_or_before":"2026-09-11"');
  expect(JSON.stringify(next.active.filter)).toContain('"on_or_before":"2026-09-08"');
});

test("verifies views when Notion decodes property IDs in view responses", async () => {
  const now = new Date("2026-09-08T09:00:01.761Z");
  const propertyIds = {
    Status: "n%60n%7C",
    "Needs Review": "Ns%3DA",
    "Source State": "Qcs%40",
    "Blocked By": "%7Bm%5Dp",
    Readiness: "%5B%5Bas",
    "Available From": "PKBT",
    "Official Due": "OW%3C%7B",
    Planned: "S%3FfY",
  } as const;
  const schema = {
    properties: Object.fromEntries(Object.entries(propertyIds).map(([name, id]) => [name, { id }])),
  };
  const decodeProperties = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(decodeProperties);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          key === "property" && typeof item === "string"
            ? decodeURIComponent(propertyIds[item as keyof typeof propertyIds] ?? item)
            : decodeProperties(item),
        ]),
      );
    }
    return value;
  };
  const definitions = plannerViewDefinitions(now);
  const namesById = new Map<string, keyof typeof definitions>(
    Object.entries(PLANNER_VIEWS).map(([name, id]) => [id, name as keyof typeof definitions]),
  );
  let patches = 0;
  const httpClient = HttpClient.make((request, url) => {
    const pathname = new URL(String(url)).pathname;
    let body: unknown;
    if (pathname === "/v1/data_sources/source-id") {
      body = schema;
    } else {
      const id = pathname.split("/").at(-1) ?? "";
      const name = namesById.get(id) as keyof typeof definitions | undefined;
      if (!name) throw new Error(`Unexpected Notion request: ${pathname}`);
      if (request.method === "PATCH") patches += 1;
      body = { id, ...(decodeProperties(definitions[name]) as Record<string, unknown>) };
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status: 200 })),
    );
  });
  const client = new NotionClient("secret-token", "source-id", httpClient);

  await Effect.runPromise(client.syncPlannerViews(now));

  expect(patches).toBe(0);
});
