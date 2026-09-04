import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { NotionClient } from "../../src/notion/client";

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
