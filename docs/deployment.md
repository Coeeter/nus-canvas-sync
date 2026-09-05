# Dokploy deployment

The production artifact is `ghcr.io/coeeter/nus-canvas-sync:latest`, published
by `.github/workflows/container.yml` after the full test suite. Deploy the
immutable `sha-<7 characters>` tag for rollback-safe releases. The image
contains Bun 1.4.0, Canvas CLI 1.13.0, Codex CLI 0.150.1, GitHub CLI 2.98.0,
and `pdftotext`. It contains no credentials and runs as UID 10001. It has no
cron daemon.

## Persistent volumes

Mount:

- `/data` for immutable snapshots, atomic per-course state, pending-create
  recovery journals, run status, and the run lock;
- `/codex-home` for the dedicated Codex login (`CODEX_HOME`). Treat its
  `auth.json` as password-equivalent.

Initialize Codex authentication once on the VPS without copying it into Git or
an image. After Dokploy creates `nus-sync-codex`, use a temporary root-owned
container to copy the already authenticated VPS `auth.json` into that volume,
then make the copied file UID/GID 10001 with mode `0600`. Resolve and verify the
exact Docker volume name first; never use a partial match. Do not print or
inspect `auth.json`. Validate from the running Application only with
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

Create one read-only Doppler service token for `nus-sync/prod` and configure it
as a Dokploy Doppler vault provider named `nus-sync-prod`, scoped to the
**personal** project. Reference the remote values from the Application environment;
Dokploy resolves them at deployment time without storing their values:

```text
CANVAS_URL=${{vault.nus-sync-prod.CANVAS_URL}}
CANVAS_TOKEN=${{vault.nus-sync-prod.CANVAS_TOKEN}}
GH_TOKEN=${{vault.nus-sync-prod.GH_TOKEN}}
NOTION_TOKEN=${{vault.nus-sync-prod.NOTION_TOKEN}}
NOTION_DATA_SOURCE_ID=${{vault.nus-sync-prod.NOTION_DATA_SOURCE_ID}}
RESEND_API_KEY=${{vault.nus-sync-prod.RESEND_API_KEY}}
ALERT_EMAIL_FROM=${{vault.nus-sync-prod.ALERT_EMAIL_FROM}}
ALERT_EMAIL_TO=${{vault.nus-sync-prod.ALERT_EMAIL_TO}}
```

Add the optional Notion overrides the same way when present. Never paste secret
values into logs, build arguments, source files, Dokploy environment text, or chat.

## Dokploy application and schedule

Create a Dokploy **Application** under the **personal** project with the Docker
provider. Select the existing private GHCR registry credential and set the image
to the verified immutable
`ghcr.io/coeeter/nus-canvas-sync:sha-<7 characters>` tag. Set the Application
command to `sleep infinity`, add the vault-backed environment above, and mount
the `nus-sync-data` volume at `/data` and the `nus-sync-codex` volume at
`/codex-home`.

Dokploy Application jobs use `docker exec`, so the idle Application container
must remain running. Configure one Application schedule whose command is
`bun run sync`; do not add Compose or an in-image cron daemon.

Configure Dokploy in `Asia/Singapore` with exactly:

```text
0 7,12,17,22 * * *
```

This runs at 07:00, 12:00, 17:00, and 22:00. Do not add a 03:00 run.

## First run and verification

1. Stop every old scheduled/manual sync before replacing an image that used the
   previous create/unlink lock. The current process uses `flock`; never unlink
   `/data/run.lock`, because doing so can create two independently locked inodes.
2. Pull the immutable SHA tag produced by CI and run
   `HEALTHCHECK_MODE=artifacts bun run healthcheck`. The default healthcheck is
   expected to fail before the first successful state-bearing sync.
3. Run `bun run collect` once and inspect the generated manifest. Every required
   endpoint must be `ok` or a declared capability gap with successful alternates.
4. Review `config/notion-identity-migrations.json` against the current live page
   IDs. Back up `/data` before the first migration-bearing run.
5. Run `bun run sync` manually. Confirm concise `sync_finished` JSON, the five
   per-course outcomes, Review-first behavior, and the dashboard health callout.
6. Confirm `/data/courses` contains five course files only after successful
   verified reconciliation. A failed course must retain its previous state.
   If `/data/pending-creates` contains an entry, do not repeat creates blindly:
   resolve whether Notion committed that identity first.
7. Run the default `bun run healthcheck`; it must verify the successful run and
   fresh state for all five courses.
8. Enable the four Dokploy schedules only after that manual run succeeds.

Rollback is to disable the Dokploy schedule and pin the previous working image
SHA. The paused legacy automation stays paused unless Nas explicitly chooses to
reactivate it; do not delete or reactivate it automatically.
