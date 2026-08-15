# NUS Canvas Sync

Creates a read-only Canvas snapshot for the NUS Semester 1 planner.

## Run

Requirements: authenticated `canvas-cli` and `jq`.

```sh
./sync.sh
```

The script writes a timestamped snapshot under `snapshots/` and points `latest` to it. Each course includes assignments and submission state, quizzes, complete announcement bodies, modules, the homepage, and every Canvas page. `planner.json` provides the combined calendar/planner feed.

Failed endpoints produce `*.error.json` files instead of silently becoming empty data. This matters because some NUS courses do not expose the Canvas quiz endpoint.

## AI handoff

The script guarantees collection; the AI interprets it. An agent should:

1. Verify every expected file or explain its `*.error.json`.
2. Parse announcement and page prose for deadlines, cancellations, attendance rules, preparation, and in-class activities.
3. Follow official external course links found in the homepage or pages, such as the CS2030S GitHub site.
4. Match records by Canvas course ID, item type, and item ID before updating Notion.
5. Preserve personal Notion fields and flag conflicts for review.

Canvas remains read-only. This script does not modify Canvas or Notion.
