import { expect, test } from "bun:test";

test("Codex response objects require every declared property", async () => {
  const schema = await Bun.file("schemas/course-candidates.schema.json").json();
  const candidate = schema.properties.candidates.items;

  expect(candidate.required.slice().sort()).toEqual(Object.keys(candidate.properties).sort());
  for (const name of ["availableFrom", "dueAt", "eventEndsAt"]) {
    expect(candidate.properties[name].type).toContain("null");
  }
  assertObjectPropertiesAreRequired(schema);
});

test("schema couples date and review states to their value shape", async () => {
  const schema = await Bun.file("schemas/course-candidates.schema.json").json();
  const dateBranches = schema.$defs.dateEvidence.anyOf;
  const reviewBranches = schema.$defs.reviewValue.anyOf;
  expect(dateBranches).toHaveLength(2);
  expect(reviewBranches).toHaveLength(2);
  expect(dateBranches[0].properties.state.const).toBe("value");
  expect(dateBranches[0].properties.value.$ref).toBe("#/$defs/machineDate");
  expect(dateBranches[1].properties.state.enum).toEqual(["unknown", "explicit-null"]);
  expect(dateBranches[1].properties.value.type).toBe("null");
  expect(reviewBranches[0].properties.state.const).toBe("value");
  expect(reviewBranches[0].properties.value.type).toBe("string");
  expect(reviewBranches[1].properties.state.enum).toEqual(["unknown", "explicit-null"]);
  expect(reviewBranches[1].properties.value.type).toBe("null");
});

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: Array<string>;
  items?: SchemaNode | Array<SchemaNode>;
  anyOf?: Array<SchemaNode>;
  $defs?: Record<string, SchemaNode>;
}

function assertObjectPropertiesAreRequired(node: SchemaNode | undefined) {
  if (!node || typeof node !== "object") return;
  if (node.type === "object" && node.properties) {
    expect(node.required?.slice().sort()).toEqual(Object.keys(node.properties).sort());
    for (const child of Object.values(node.properties)) assertObjectPropertiesAreRequired(child);
  }
  if (Array.isArray(node.items)) {
    for (const child of node.items) assertObjectPropertiesAreRequired(child);
  } else {
    assertObjectPropertiesAreRequired(node.items);
  }
  for (const child of node.anyOf ?? []) assertObjectPropertiesAreRequired(child);
  for (const child of Object.values(node.$defs ?? {})) assertObjectPropertiesAreRequired(child);
}
