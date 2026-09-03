import { createHash } from "node:crypto";

/** Deterministic key ordering so field insertion order never affects the hash. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Content hash over task-relevant fields only, per SRC-002. */
export function contentHash(fields: Record<string, unknown>) {
  const canonical = JSON.stringify(canonicalize(fields));
  return createHash("sha256").update(canonical).digest("hex");
}
