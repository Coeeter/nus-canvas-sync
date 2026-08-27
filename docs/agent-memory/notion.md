# Notion integration

## Maintained instruction copy

The Notion **Agent Instructions** page is a complete operational copy for ChatGPT, Claude, or another agent that can access Notion but not this repository. When a durable rule changes here, update that page in the same task. Preserve equivalent behavior rather than requiring identical wording.

- Agent Instructions: <https://app.notion.com/p/3bd703fb987d81d88ce5dfdd277b1b2f>
- Dashboard: <https://app.notion.com/p/3bd703fb987d81f4a438c7d430b7c38f>
- Actions data source: `collection://e04655de-e228-44cb-9042-597968f7057a`
- Assignments & projects page: <https://app.notion.com/p/3c9703fb987d81b8a3ffe3fd257faf09>
- Assignments & projects view: `view://3c9703fb-987d-81f0-88ab-000c9f44adae`
- Urgent view: `view://3bd703fb-987d-81cb-8ea1-000c442ee0f9`

Fetch the live data-source schema before constructing queries or updates. Date properties use expanded connector keys such as `date:Available From:start` and `date:Planned:start`; use the current connector's documented date format.

## View invariants

- `Urgent` uses `Status != Done` AND `Status != Dropped` AND (`Official Due <= cutoff` OR `Planned <= cutoff`). The cutoff is today in Asia/Singapore plus three calendar days.
- Advancing Urgent changes only the cutoff value. Preserve the filter shape and sort by `Planned` ascending, then `Official Due` ascending.
- `Next & Active` shows actionable `Ready`, `Doing`, and near-term `Scheduled` work. It independently excludes `Done`, `Dropped`, `Needs Review`, future backlog, and prerequisite-blocked successors.
- `Assignments & projects` is grouped by user-owned `Status`, excludes `Done` and `Dropped`, and shows `Start By` and `Official Due` while hiding agent/source metadata.
- Course workflow views and routine action views keep `Readiness`, `Start By`, source identity, and sync metadata hidden.

Treat filters, sorts, grouping, and dependency behavior as planner logic. Preserve them unless Nas explicitly changes the behavior.

## Write boundary

Ordinary planner records, course guidance, dashboard callouts, and the maintained Agent Instructions copy may be updated. Canvas and course GitHub sources remain read-only. Ask Nas before changing the Notion database structure or dashboard layout.
