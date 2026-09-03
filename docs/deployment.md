# Dokploy deployment

The production artifact is `ghcr.io/coeeter/nus-canvas-sync:latest`, published
by `.github/workflows/container.yml` after the full test suite. Deploy the
immutable `sha-<7 characters>` tag for rollback-safe releases. The image
contains Bun 1.4.0, Canvas CLI 1.13.0, Codex CLI 0.150.1, GitHub CLI 2.98.0,
Doppler CLI 3.76.1, and `pdftotext`. It contains no credentials and runs as UID
10001. It has no cron daemon.

## Persistent volumes

Mount:

- `/data` for immutable snapshots, per-course successful baselines, and the run lock;
- `/codex-home` for the dedicated Codex login (`CODEX_HOME`). Treat its
  `auth.json` as password-equivalent.

Initialize Codex authentication once on the VPS without copying it into Git or
an image. Copy the already authenticated VPS Codex home into the dedicated
volume using a temporary root-owned container, then make the volume contents
UID/GID 10001. Do not print or inspect `auth.json`. Validate only with
`codex --version` and a harmless authenticated non-interactive invocation.

## Doppler configuration

Create project `nus-sync` and configuration `prod`. Set these runtime values:

- `CANVAS_URL`, `CANVAS_TOKEN` from the authenticated local Canvas CLI config;
- `GH_TOKEN` from the authenticated GitHub CLI with read-only repository scope;
- `NOTION_TOKEN` for the existing Actions data source;
- `NOTION_DATA_SOURCE_ID=e04655de-e228-44cb-9042-597968f7057a`;
- `RESEND_API_KEY`, copied internally from `aianiart-api` production;
- `ALERT_EMAIL_FROM` using the verified Resend sender;
- `ALERT_EMAIL_TO=nasrullah01n@gmail.com`;
- optional `NOTION_DASHBOARD_URL` and `NOTION_HEALTH_BLOCK_ID` overrides.

Create one read-only Doppler service token for `nus-sync/prod`. Store only that
token in Dokploy as `DOPPLER_TOKEN`; the entrypoint uses `doppler run` so the
remaining values do not need to be duplicated in Dokploy. Never paste secret
values into logs, build arguments, Compose files, or chat.

## Dokploy application and schedule

Create a Compose/application job under the **personal** project using
`compose.yaml` or the GHCR image directly. Attach both persistent volumes and
set `DOPPLER_TOKEN`. The scheduled command is the image default (`bun run sync`).

Configure Dokploy in `Asia/Singapore` with exactly:

```text
0 7,12,17,22 * * *
```

This runs at 07:00, 12:00, 17:00, and 22:00. Do not add a 03:00 run.

## First run and verification

1. Pull the immutable SHA tag produced by CI and run `bun run healthcheck`.
2. Run `bun run collect` once and inspect the generated manifest. Every required
   endpoint must be `ok` or a declared capability gap with successful alternates.
3. Run `bun run sync` manually. Confirm concise `sync_finished` JSON, the five
   per-course outcomes, Review-first behavior, and the dashboard health callout.
4. Confirm `/data/baselines` contains five course files only after successful
   verified reconciliation. A failed course must retain its earlier mtime.
5. Enable the four Dokploy schedules only after that manual run succeeds.

Rollback is to disable the Dokploy schedule and pin the previous working image
SHA. The paused legacy automation stays paused unless Nas explicitly chooses to
reactivate it; do not delete or reactivate it automatically.
