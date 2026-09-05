import { Effect, Redacted, Schedule, Schema } from "effect";
import { type HttpClient, HttpClientRequest } from "effect/unstable/http";

export interface FailureAlert {
  runId: string;
  runTime: string;
  summary: string;
  failures: ReadonlyArray<{ course: string; stage: string; detail: string }>;
  dashboardUrl: string;
}

export class ResendRequestError extends Schema.TaggedError<ResendRequestError>()(
  "ResendRequestError",
  {
    message: Schema.String,
    retryable: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {}

export class ResendAlertClient {
  readonly #apiKey: Redacted.Redacted<string>;

  constructor(
    apiKey: string | Redacted.Redacted<string>,
    readonly from: string,
    readonly to: string,
    readonly httpClient: HttpClient.HttpClient,
  ) {
    this.#apiKey = typeof apiKey === "string" ? Redacted.make(apiKey) : apiKey;
  }

  send(alert: FailureAlert) {
    return sendAlert(this, alert);
  }

  request(alert: FailureAlert) {
    const detail = alert.failures
      .map((failure) => `${failure.course} (${failure.stage}): ${failure.detail}`)
      .join("\n");
    const body = {
      from: this.from,
      to: [this.to],
      subject: `NUS sync failed — ${alert.runTime}`,
      text: `${alert.summary}\n\n${detail}\n\nDashboard: ${alert.dashboardUrl}`,
      html: `<p><strong>${escapeHtml(alert.summary)}</strong></p><pre>${escapeHtml(detail)}</pre><p><a href="${escapeHtml(alert.dashboardUrl)}">Open dashboard</a></p>`,
    };
    const request = HttpClientRequest.post("https://api.resend.com/emails").pipe(
      HttpClientRequest.bearerToken(this.#apiKey),
      HttpClientRequest.setHeader("Idempotency-Key", `nus-sync-${alert.runId}`),
      HttpClientRequest.acceptJson,
    );
    return HttpClientRequest.bodyJson(request, body).pipe(
      Effect.flatMap(this.httpClient.execute),
      Effect.timeout("30 seconds"),
      Effect.mapError(
        (cause) =>
          new ResendRequestError({
            message: "Resend request failed",
            retryable: true,
            cause,
          }),
      ),
    );
  }
}

const sendAlertAttempt = Effect.fn("ResendAlertClient.send")(function* (
  client: ResendAlertClient,
  alert: FailureAlert,
) {
  const response = yield* client.request(alert);
  if (response.status >= 200 && response.status < 300) return;
  return yield* new ResendRequestError({
    message: `Resend request failed (${response.status})`,
    retryable: response.status === 429 || response.status >= 500,
    cause: response.status,
  });
});

const sendAlert = (client: ResendAlertClient, alert: FailureAlert) =>
  sendAlertAttempt(client, alert).pipe(
    Effect.retry(($) =>
      $(Schedule.max([Schedule.spaced("250 millis"), Schedule.recurs(1)])).pipe(
        Schedule.while(({ input }) => input.retryable),
      ),
    ),
  );

function escapeHtml(value: string) {
  const escapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => escapes[character] ?? character);
}
