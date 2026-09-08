import { expect, test } from "bun:test";
import { plannerViewDefinitions } from "../../src/notion/views";

test("rolling planner filters advance with each sync", () => {
  const first = plannerViewDefinitions(new Date("2026-09-06T04:00:00Z"));
  const next = plannerViewDefinitions(new Date("2026-09-08T12:00:00Z"));

  expect(JSON.stringify(first.urgent.filter)).toContain('"on_or_before":"2026-09-09"');
  expect(JSON.stringify(next.urgent.filter)).toContain('"on_or_before":"2026-09-11"');
  expect(JSON.stringify(next.active.filter)).toContain('"on_or_before":"2026-09-08"');
});
