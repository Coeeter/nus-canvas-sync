# NUS Canvas Sync

Creates a read-only Canvas snapshot for the NUS Semester 1 planner.

## Run

Requirements: authenticated `canvas-cli`, authenticated GitHub CLI (`gh`), and `jq`.

```sh
./sync.sh
```

The script writes a timestamped snapshot under `snapshots/` and points `latest` to it. Each course includes assignments and submission state, quizzes, complete announcement bodies, the course file index, modules, the homepage, and every Canvas page. `planner.json` provides the combined calendar/planner feed. The snapshot also includes CS2030S skeleton repositories, the authenticated user's personal exercise repositories, and those personal repositories' commit histories. Other students' repositories are excluded. The manifest names the expected sources so an agent can verify coverage without hard-coding it in a prompt.

Failed endpoints produce `*.error.json` files instead of silently becoming empty data. This matters because some NUS courses do not expose the Canvas quiz endpoint.

## AI handoff

The script guarantees collection; the AI interprets it. Before planner work, read [`AGENTS.md`](AGENTS.md) and the documents it requires under [`docs/agent-memory/`](docs/agent-memory/). Those files are the repository's durable planner memory and are maintained alongside the complete Notion Agent Instructions copy.

At a high level, an agent should:

1. Verify every expected file or explain its `*.error.json`.
2. Parse announcement and page prose for deadlines, cancellations, attendance rules, preparation, and in-class activities.
3. Use the file index to identify linked briefs, specifications, rubrics, and project guidance. Download only the relevant documents when their contents are needed to judge assignment scope or lead time.
4. Follow official external course links found in the homepage or pages, such as the CS2030S GitHub site.
5. Match records by Canvas course ID, item type, and item ID before updating Notion.
6. Preserve personal Notion fields and flag conflicts for review.

Canvas remains read-only. This script does not modify Canvas or Notion.
