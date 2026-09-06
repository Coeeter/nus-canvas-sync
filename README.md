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
```

`./sync.sh` remains the compatibility wrapper for source-only collection.

The complete sync requires `CANVAS_URL`, `CANVAS_TOKEN`, `GH_TOKEN`,
`NOTION_TOKEN`, `RESEND_API_KEY`, and `ALERT_EMAIL_FROM`. `ALERT_EMAIL_TO`
defaults to `nasrullah01n@gmail.com`; `DATA_DIR` defaults to `/data` in the
container. Secrets must be injected at runtime, preferably by the Doppler
vault provider described in [deployment.md](docs/deployment.md).

## Runtime behavior

- Course baselines advance independently only after verified Notion writes.
- A timetable/cadence can create Expected context but never an active quiz.
- GEA1000/GESS1001 e-lectures are work; IS1128/CS2030S/MA1301 lecture attendance is not.
- Physical labs/tutorials/recitations are not todos; real preparation expires after its event.
- Manual Notion rows without a Canvas Item ID remain fully user-owned.
- Real failures update the dashboard, retain failed baselines, exit nonzero, and
  send one idempotent Resend email.

See [docs/context.md](docs/context.md), the approved
[specification](docs/task-tracker/spec.md), and the
[deployment runbook](docs/deployment.md).
