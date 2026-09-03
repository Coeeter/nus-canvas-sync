import { expect, test } from "bun:test";
import { NotionClient } from "../../src/notion/client";

test("queries the configured data source without exposing the token in the URL", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const request = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(
      new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }), {
        status: 200,
      }),
    );
  }) as typeof fetch;
  const client = new NotionClient("secret-token", "source-id", request);
  expect(await client.queryActions()).toEqual([]);
  expect(calls[0]?.url).toEndWith("/v1/data_sources/source-id/query");
  expect(calls[0]?.url).not.toContain("secret-token");
});
