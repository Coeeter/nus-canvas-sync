import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { COURSES } from "../config/courses";
import type { ExistingAction } from "../reconcile/plan";

const MappingSchema = Schema.Struct({
  pageId: Schema.NonEmptyString,
  fromIdentity: Schema.NonEmptyString,
  toIdentity: Schema.NonEmptyString,
});
export type IdentityMapping = typeof MappingSchema.Type;

export function applyIdentityMappings(
  actions: ReadonlyArray<ExistingAction>,
  mappings: ReadonlyArray<IdentityMapping>,
): Array<ExistingAction> {
  const used = new Set<string>();
  const result = [...actions];
  for (const mapping of mappings) {
    if (used.has(mapping.pageId)) throw new Error(`Duplicate mapping for page ${mapping.pageId}`);
    used.add(mapping.pageId);
    const index = result.findIndex((row) => row.id === mapping.pageId);
    const row = result[index];
    if (
      !row?.automatedIdentity ||
      ![mapping.fromIdentity, mapping.toIdentity].includes(row.automatedIdentity)
    )
      throw new Error(`Identity mapping ownership changed: ${mapping.pageId}`);
    const course = COURSES.find((course) => course.code === row.properties.Course);
    if (
      !course ||
      ![`course:${course.id}:`, `candidate:${course.code}:`, `bundle:${course.code}:`].some(
        (prefix) => mapping.toIdentity.startsWith(prefix),
      )
    )
      throw new Error(`Identity mapping crosses course boundary: ${mapping.pageId}`);
    if (
      result.some((other) => other.id !== row.id && other.automatedIdentity === mapping.toIdentity)
    )
      throw new Error(`Identity mapping would merge two existing pages: ${mapping.toIdentity}`);
    result[index] = { ...row, automatedIdentity: mapping.toIdentity };
  }
  return result;
}

export const mappedActions = Effect.fn("mappedActions")(function* (
  dataDir: string,
  actions: ReadonlyArray<ExistingAction>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = join(dataDir, "identity-mappings.json");
  if (!(yield* fs.exists(path))) return actions;
  const mappings = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Array(MappingSchema)),
  )(yield* fs.readFileString(path));
  return yield* Effect.try(() => applyIdentityMappings(actions, mappings));
});
