# NUS course planner

A small agent-driven Canvas-to-Notion planner. SQLite is canonical state, one
Codex session reconciles every active course, and Notion is a human-facing
projection.

## Runtime flow

1. Export the latest complete Canvas corpus.
2. Import current Notion rows and highlight user changes.
3. Give Codex full CRUD over an isolated SQLite copy.
4. Validate and atomically promote the database.
5. Diff, publish, and verify Notion.

Canvas is strictly read-only. Codex never receives Notion credentials.

## Commands

All production validation is container-based.

```sh
docker build -t nus-course-planner .
docker run --rm nus-course-planner bun run healthcheck
docker run --rm --env-file .env -v nus-sync-data:/data -v nus-sync-codex:/codex-home \
  nus-course-planner bun run sync

# Deployment-equivalent service with persistent SQLite and Codex volumes
docker compose up -d
docker compose exec planner bun run sync
```

`bun run sync` stops after producing `/data/runs/<run>/notion-diff.json`.
`bun run sync:publish` applies and verifies that diff once the live Notion
schema migration is authorized.
`bun run notion:schema` reads the live schema and prints required additions,
removals, and type corrections without changing Notion.

See [the shared planner guide](docs/planner-guide.md),
[local sync-agent instructions](docs/sync-agent.md), and the
[approved specification](docs/agent-sync/spec.md).
