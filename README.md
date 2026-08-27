# NUS Canvas Sync

Creates a read-only Canvas snapshot for the NUS Semester 1 planner.

## Run

Requirements: authenticated `canvas-cli` and `jq`.

```sh
./sync.sh
```

The script writes a timestamped snapshot under `snapshots/` and points `latest` to it. Each course includes assignments and submission state, quizzes, complete announcement bodies, the course file index, modules, the homepage, and every Canvas page. `planner.json` provides the combined calendar/planner feed. The manifest names the expected endpoint set so an agent can verify coverage without hard-coding it in a prompt.

Failed endpoints produce `*.error.json` files instead of silently becoming empty data. This matters because some NUS courses do not expose the Canvas quiz endpoint.

## AI handoff

The script guarantees collection; the AI interprets it. An agent should:

1. Verify every expected file or explain its `*.error.json`.
2. Parse announcement and page prose for deadlines, cancellations, attendance rules, preparation, and in-class activities.
3. Use the file index to identify linked briefs, specifications, rubrics, and project guidance. Download only the relevant documents when their contents are needed to judge assignment scope or lead time.
4. Follow official external course links found in the homepage or pages, such as the CS2030S GitHub site.
5. Match records by Canvas course ID, item type, and item ID before updating Notion.
6. Preserve personal Notion fields and flag conflicts for review.

For assignments, keep the three-day urgent queue focused on immediate work. Maintain a separate agent-owned `Start By` date based on the actual brief: roughly three days for short well-scoped work, seven days for substantial individual work, and at least fourteen days for group or multi-stage work. Start earlier when coordination, dependencies, or the source material require it. `Status` remains the only user-controlled workflow field.

Canvas remains read-only. This script does not modify Canvas or Notion.
