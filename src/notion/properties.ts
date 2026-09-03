const TEXT = new Set([
  "Canvas Course ID",
  "Canvas Item ID",
  "Canvas Item Type",
  "Parent Canvas ID",
  "Notes",
  "Blocked By",
]);
const SELECT = new Set(["Course", "Readiness", "Status", "Type", "Work Mode", "Source State"]);
const DATE = new Set(["Available From", "Official Due", "Last Synced", "Planned", "Start By"]);

export function encodeNotionProperties(properties: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => {
      if (name === "Action") return [name, { title: richText(value) }];
      if (TEXT.has(name)) return [name, { rich_text: richText(value) }];
      if (SELECT.has(name))
        return [name, { select: value == null ? null : { name: String(value) } }];
      if (DATE.has(name)) return [name, { date: value == null ? null : { start: String(value) } }];
      if (name === "Needs Review" || name === "Grade Affecting" || name === "Pinned") {
        return [name, { checkbox: Boolean(value) }];
      }
      if (name === "Source URL" || name === "Course Page") return [name, { url: value ?? null }];
      if (name === "Missing Syncs") return [name, { number: value ?? null }];
      throw new Error(`Unsupported Notion property: ${name}`);
    }),
  );
}

export function readNotionText(property: unknown): string | null {
  if (!property || typeof property !== "object") return null;
  const values =
    (
      property as {
        rich_text?: Array<{ plain_text?: string }>;
        title?: Array<{ plain_text?: string }>;
      }
    ).rich_text ?? (property as { title?: Array<{ plain_text?: string }> }).title;
  return values?.map((value) => value.plain_text ?? "").join("") || null;
}

export function decodeNotionProperties(properties: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(properties).map(([name, property]) => [name, readNotionValue(property)]),
  );
}

function readNotionValue(property: unknown): unknown {
  if (!property || typeof property !== "object") return null;
  const value = property as Record<string, unknown>;
  if ("title" in value || "rich_text" in value) return readNotionText(property);
  if ("select" in value) return (value.select as { name?: string } | null)?.name ?? null;
  if ("status" in value) return (value.status as { name?: string } | null)?.name ?? null;
  if ("checkbox" in value) return Boolean(value.checkbox);
  if ("date" in value) return (value.date as { start?: string } | null)?.start ?? null;
  if ("url" in value) return value.url ?? null;
  if ("number" in value) return value.number ?? null;
  return null;
}

function richText(value: unknown) {
  return value == null || value === "" ? [] : [{ type: "text", text: { content: String(value) } }];
}
