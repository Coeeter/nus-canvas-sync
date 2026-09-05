import { expect, test } from "bun:test";
import { Effect } from "effect";
import { NotionClient } from "../../src/notion/client";
import { PLANNER_VIEWS } from "../../src/notion/views";
import { notionServer } from "../support/notion-server";

// Evaluate the small documented Notion filter subset against saved rows.
function matches(valueFilter: unknown, row: Record<string, unknown>): boolean {
  const filter = valueFilter as {
    and?: Array<unknown>;
    or?: Array<unknown>;
    property: string;
    select?: Record<string, unknown>;
    checkbox?: Record<string, unknown>;
    rich_text?: Record<string, unknown>;
    date?: Record<string, unknown>;
  };
  if (filter.and) return filter.and.every((item: unknown) => matches(item, row));
  if (filter.or) return filter.or.some((item: unknown) => matches(item, row));
  const value = row[filter.property];
  const op = filter.select ?? filter.checkbox ?? filter.rich_text ?? filter.date!;
  if ("equals" in op) return value === op.equals;
  if ("does_not_equal" in op) return value !== op.does_not_equal;
  if ("is_empty" in op) return value == null || value === "";
  if (typeof op.on_or_before === "string")
    return (
      typeof value === "string" &&
      (op.on_or_before.length === 10
        ? value.slice(0, 10) <= op.on_or_before
        : Date.parse(value) <= Date.parse(op.on_or_before))
    );
  throw new Error("Unsupported fixture operator");
}
test("saved view predicates roll daily and exclude expired, locked, terminal and blocked work", async () => {
  const server = notionServer();
  const client = new NotionClient("fixture", "fixture", server.http);
  await Effect.runPromise(client.syncPlannerViews(new Date("2026-09-05T23:00:00+08:00")));
  const view = server.views.get(PLANNER_VIEWS.urgent)!;
  const ready = {
    Status: "Not started",
    Readiness: "Ready",
    "Needs Review": false,
    "Official Due": "2026-09-08",
    Planned: null,
  };
  expect(matches(view.filter, ready)).toBe(true);
  for (const patch of [
    { Readiness: "Later", Planned: "2026-09-01" },
    { Readiness: "Locked" },
    { Status: "Done" },
    { Status: "Dropped" },
    { "Needs Review": true },
    { "Blocked By": "Quiz 1" },
    { "Available From": "2026-09-06T00:00:00+08:00" },
  ])
    expect(matches(view.filter, { ...ready, ...patch })).toBe(false);
  expect(matches(view.filter, { ...ready, "Official Due": "2026-09-09" })).toBe(false);
  await Effect.runPromise(client.syncPlannerViews(new Date("2026-09-06T00:00:00+08:00")));
  expect(
    matches(server.views.get(PLANNER_VIEWS.urgent)!.filter, {
      ...ready,
      "Official Due": "2026-09-09",
    }),
  ).toBe(true);
  expect(server.views.get(PLANNER_VIEWS.urgent)!.sorts).toEqual([
    { property: "Planned", direction: "ascending" },
    { property: "Official Due", direction: "ascending" },
  ]);
});
