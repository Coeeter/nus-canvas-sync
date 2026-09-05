# NUS Canvas Sync

A small, deterministic university task tracker for Nas. It collects normalized
Canvas and CS2030S GitHub evidence, computes per-course semantic diffs, applies
safe lifecycle rules, sends only changed prose to an isolated Codex process, and
projects verified actions into the existing Notion Actions database.

It does not mirror Canvas, create attendance todos, invent release dates, or let
AI decide availability/completion. Ambiguous evidence goes to **Review first**.

## Commands

```sh
bun install
bun run collect       # source snapshot only
bun run sync          # complete collection -> Notion -> baseline run
bun run check         # typecheck, lint, and all tests
bun run test:local    # state transitions and local HTTP boundary tests
```

`./sync.sh` remains the compatibility wrapper for source-only collection.

The complete sync requires `CANVAS_URL`, `CANVAS_TOKEN`, `GH_TOKEN`,
`NOTION_TOKEN`, `RESEND_API_KEY`, and `ALERT_EMAIL_FROM`. `ALERT_EMAIL_TO`
defaults to `nasrullah01n@gmail.com`; `DATA_DIR` defaults to `/data` in the
container. Secrets must be injected at runtime, preferably by the Doppler
vault provider described in [deployment.md](docs/deployment.md).

## Runtime behavior

- Course baselines advance independently only after verified Notion writes.
- Current records, interpretation, reconciliation ownership, and user-decision
  metadata commit together in `DATA_DIR/courses/<course>.json`.
- A timetable/cadence can create Expected context but never an active quiz.
- GEA1000/GESS1001 e-lectures are work; IS1128/CS2030S/MA1301 lecture attendance is not.
- Physical labs/tutorials/recitations are not todos; real preparation expires after its event.
- Manual Notion rows without a Canvas Item ID remain fully user-owned.
- Real failures update the dashboard, retain failed baselines, exit nonzero, and
  send one idempotent Resend email.
- Locked Canvas pages/files remain explicit source records and defer extraction
  until Canvas releases them; malformed or unexpectedly unreadable required
  content fails that course instead of becoming an empty planner.

`bun run healthcheck` verifies the last successful run and all five course state
files are fresh. Use `HEALTHCHECK_MODE=artifacts bun run healthcheck` only while
verifying a newly built image before its first sync.

One-time legacy Notion identity decisions live in
[`config/notion-identity-migrations.json`](config/notion-identity-migrations.json).
Mappings update an existing page in place, `retire` archives a known obsolete
generated row, and `preserve` leaves an important legacy row untouched until a
current canonical source replaces it. Page ownership and course boundaries are
checked before any migration write.

See [docs/context.md](docs/context.md), the approved
[specification](docs/task-tracker/spec.md), and the
[deployment runbook](docs/deployment.md).
