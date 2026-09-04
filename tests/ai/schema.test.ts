import { expect, test } from "bun:test";

test("Codex response objects require every declared property", async () => {
  const schema = await Bun.file("schemas/course-candidates.schema.json").json();
  const candidate = schema.properties.candidates.items;

  expect(candidate.required.slice().sort()).toEqual(Object.keys(candidate.properties).sort());
  for (const name of ["availableFrom", "dueAt", "eventEndsAt"]) {
    expect(candidate.properties[name].type).toContain("null");
  }
});
