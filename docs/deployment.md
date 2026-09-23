# Dokploy Compose deployment

Deploy `compose.yaml` as one Dokploy Compose service. SQLite is embedded in the
planner process; there is no database server container.

## Persistent volumes

- `planner-data` mounts at `/data` and contains `planner.db`, the latest Canvas
  corpus, run transcripts, audits, and pending publication state.
- `planner-codex-home` mounts at `/codex-home` and contains Codex authentication.
  Treat its `auth.json` as password-equivalent.

Never recreate either named volume during a routine image update. Back up the
complete existing Notion database before the initial schema cutover.

## Runtime secrets

Supply through the Dokploy Doppler vault provider: `CANVAS_URL`, `CANVAS_TOKEN`,
`NOTION_TOKEN`, `NOTION_DATA_SOURCE_ID`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM`,
and `ALERT_EMAIL_TO`.

`CODEX_MODEL` defaults to `gpt-6-luna` and `CODEX_REASONING` defaults to
`medium`; both can be overridden for the single reconciliation session. Do not
place secret values in Compose source, build arguments, logs, or chat.

## Service and schedule

The container idles with `sleep infinity`. Configure the Dokploy scheduled
command against the `planner` service:

```text
bun run sync:publish
```

Use timezone `Asia/Singapore` and cron schedule:

```text
0 7,12,17,22 * * *
```

Before enabling publication or the schedule:

1. Build and start the Compose service.
2. Install authenticated Codex state in `planner-codex-home` with ownership
   UID/GID 10001 and mode `0600` without printing it.
3. Run `bun run healthcheck` inside the service.
4. Run `bun run sync` to generate and inspect the live Notion migration diff.
5. Obtain explicit authorization for difficult-to-reverse Notion property
   removal.
6. Run `bun run sync:publish`, refetch Notion, and verify SQLite agreement.
7. Run it a second time and require an empty diff before enabling the schedule.

Rollback disables the schedule and pins the previous image. Preserve both
volumes so pending publication and audit history remain available.
