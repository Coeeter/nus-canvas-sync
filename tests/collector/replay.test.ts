import { describe, expect, test } from "bun:test";
import { replayFixtures } from "../../src/collector/replay";

describe("replayFixtures", () => {
  test("normalize+diff over the baseline fixture is deterministic and schema-honest", () => {
    const results = replayFixtures("tests/fixtures/sources/baseline");
    const cs2030s = results.CS2030S;
    expect(cs2030s).toBeDefined();
    // Exercise 2 is newly added; Midterm's unlock changed; Sit-In Lab 1 is untouched.
    expect(cs2030s?.added.map((r) => r.fields.name)).toEqual(["Exercise 2"]);
    expect(cs2030s?.changed.map((c) => c.after.fields.name)).toEqual(["Midterm"]);
    expect(cs2030s?.removed).toEqual([]);
  });

  test("replaying twice produces identical results", () => {
    const first = replayFixtures("tests/fixtures/sources/baseline");
    const second = replayFixtures("tests/fixtures/sources/baseline");
    expect(first).toEqual(second);
  });
});
