# NUS Canvas Sync agent instructions

## Required context

Before any Canvas sync, Notion planner update, course-preparation analysis, scheduling change, automation change, or durable-memory change, read these files in order:

1. [`docs/agent-memory/planner-contract.md`](docs/agent-memory/planner-contract.md)
2. [`docs/agent-memory/sync-operations.md`](docs/agent-memory/sync-operations.md)
3. [`docs/agent-memory/notion.md`](docs/agent-memory/notion.md)
4. [`docs/agent-memory/decisions.md`](docs/agent-memory/decisions.md)

Use `README.md` for the collector interface. Inspect the repository and current source data instead of treating dated examples or previous run results as current.

## Maintained copies

The repository documents above and the Notion **Agent Instructions** page are maintained operational copies for different agents. Repository-aware agents read these files; Notion-only agents read the Notion page. When a durable planner rule changes, update both copies in the same task and verify that they express the same behavior.

If the copies substantively conflict, stop planner writes, identify the conflict, and ask Nas which behavior should win. A current explicit instruction from Nas takes precedence, but the durable copies still need to be reconciled.

## Safety and completion

Canvas and course GitHub sources are read-only. Coursework submission, quiz attempts, messages, enrolment changes, and permanent history deletion require Nas to act.

Planner work is complete only when source coverage is accounted for, user-owned fields are preserved, repository and Notion instructions remain consistent, relevant views are correct, and the report names only changes, overdue work, ambiguity, failures, or required responses.
