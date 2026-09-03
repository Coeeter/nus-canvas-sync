import { expect, test } from "bun:test";
import { ResendAlertClient } from "../../src/alerts/resend";

test("uses one stable idempotency key for a logical run", async () => {
  const keys: Array<string | null> = [];
  const request = ((_: string | URL | Request, init?: RequestInit) => {
    keys.push(new Headers(init?.headers).get("Idempotency-Key"));
    return Promise.resolve(new Response("{}", { status: keys.length === 1 ? 500 : 200 }));
  }) as typeof fetch;
  const client = new ResendAlertClient("secret", "sync@example.com", "nas@example.com", request);
  await client.send({
    runId: "run-1",
    runTime: "now",
    summary: "failed",
    failures: [{ course: "IS1128", stage: "ai", detail: "invalid output" }],
    dashboardUrl: "https://notion.example",
  });
  expect(keys).toEqual(["nus-sync-run-1", "nus-sync-run-1"]);
});
