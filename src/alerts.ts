export async function sendFailureAlert(runId: string, error: unknown): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;
  const to = process.env.ALERT_EMAIL_TO;
  if (!apiKey || !from || !to) return;

  const detail = error instanceof Error ? error.message : String(error);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `NUS planner sync failed (${runId})`,
      text: `The planner sync failed.\n\nRun: ${runId}\nError: ${detail.slice(0, 1500)}\n\nSQLite state and pending publication were preserved.`,
    }),
  });
  if (!response.ok) throw new Error(`Resend alert failed (${response.status})`);
}
