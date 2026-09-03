export interface FailureAlert {
  runId: string;
  runTime: string;
  summary: string;
  failures: ReadonlyArray<{ course: string; stage: string; detail: string }>;
  dashboardUrl: string;
}

export class ResendAlertClient {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly to: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async send(alert: FailureAlert) {
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.request("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `nus-sync-${alert.runId}`,
        },
        body: JSON.stringify(body),
      });
      if (response.ok) return;
      if ((response.status !== 429 && response.status < 500) || attempt === 1) {
        throw new Error(`Resend request failed (${response.status})`);
      }
      await Bun.sleep(250);
    }
  }
}

function escapeHtml(value: string) {
  const escapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => escapes[character]!);
}
