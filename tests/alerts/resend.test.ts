import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { ResendAlertClient } from "../../src/alerts/resend";

test("uses one stable idempotency key for a logical run", async () => {
  const keys: Array<string | null> = [];
  const httpClient = HttpClient.make((request) => {
    keys.push(request.headers["idempotency-key"] ?? null);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response("{}", { status: keys.length === 1 ? 500 : 200 }),
      ),
    );
  });
  const client = new ResendAlertClient("secret", "sync@example.com", "nas@example.com", httpClient);
  await Effect.runPromise(
    client.send({
      runId: "run-1",
      runTime: "now",
      summary: "failed",
      failures: [{ course: "IS1128", stage: "ai", detail: "invalid output" }],
      dashboardUrl: "https://notion.example",
    }),
  );
  expect(keys).toEqual(["nus-sync-run-1", "nus-sync-run-1"]);
});
