import type { Action, ActionValues, NotionRow } from "./types";

const NOTION_VERSION = "2025-09-03";

export class NotionClient {
  constructor(
    private readonly token: string,
    private readonly dataSourceId: string,
  ) {}

  async queryRows(): Promise<Array<NotionRow>> {
    const pages: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    do {
      const payload = await this.request(
        `/v1/data_sources/${this.dataSourceId}/query`,
        "POST",
        cursor ? { start_cursor: cursor } : {},
      );
      pages.push(...((payload.results ?? []) as Array<Record<string, unknown>>));
      cursor = payload.has_more ? String(payload.next_cursor) : undefined;
    } while (cursor);
    return pages.map(decodePage);
  }

  async schema(): Promise<Record<string, unknown>> {
    const payload = await this.request(`/v1/data_sources/${this.dataSourceId}`, "GET");
    return (payload.properties ?? {}) as Record<string, unknown>;
  }

  async exportRaw(): Promise<Record<string, unknown>> {
    const results: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    do {
      const payload = await this.request(
        `/v1/data_sources/${this.dataSourceId}/query`,
        "POST",
        cursor ? { start_cursor: cursor } : {},
      );
      results.push(...((payload.results ?? []) as Array<Record<string, unknown>>));
      cursor = payload.has_more ? String(payload.next_cursor) : undefined;
    } while (cursor);
    return { exportedAt: new Date().toISOString(), schema: await this.schema(), results };
  }

  async addDesiredProperties(): Promise<void> {
    const schema = await this.schema();
    const properties: Record<string, unknown> = {};
    if (!("Availability" in schema))
      properties.Availability = {
        select: {
          options: ["Locked", "Ready", "Blocked", "Review"].map((name) => ({ name })),
        },
      };
    if (!("Weight" in schema)) properties.Weight = { number: {} };
    if (!("Due" in schema)) properties.Due = { date: {} };
    if (!("Source" in schema)) properties.Source = { url: {} };
    if (Object.keys(properties).length > 0)
      await this.request(`/v1/data_sources/${this.dataSourceId}`, "PATCH", { properties });
  }

  async removeProperties(names: Array<string>): Promise<void> {
    if (names.length === 0) return;
    await this.request(`/v1/data_sources/${this.dataSourceId}`, "PATCH", {
      properties: Object.fromEntries(names.map((name) => [name, null])),
    });
  }

  async create(values: ActionValues): Promise<string> {
    const payload = await this.request("/v1/pages", "POST", {
      parent: { data_source_id: this.dataSourceId },
      properties: encodeValues(values),
    });
    return String(payload.id);
  }

  async update(pageId: string, values: ActionValues): Promise<void> {
    await this.request(`/v1/pages/${pageId}`, "PATCH", {
      properties: encodeValues(values),
      archived: values.archived,
    });
  }

  async patchPage(
    pageId: string,
    properties: Record<string, unknown>,
    archived?: boolean,
  ): Promise<void> {
    await this.request(`/v1/pages/${pageId}`, "PATCH", {
      properties,
      ...(archived === undefined ? {} : { archived }),
    });
  }

  async get(pageId: string): Promise<NotionRow> {
    return decodePage(await this.request(`/v1/pages/${pageId}`, "GET"));
  }

  async updateSyncStatus(blockId: string, message: string, icon: string): Promise<void> {
    await this.request(`/v1/blocks/${blockId}`, "PATCH", {
      callout: {
        rich_text: [{ type: "text", text: { content: message } }],
        icon: { type: "emoji", emoji: icon },
      },
    });
  }

  private async request(
    path: string,
    method: "GET" | "POST" | "PATCH",
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    let last: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(`https://api.notion.com${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (response.ok) return (await response.json()) as Record<string, unknown>;
        const detail = (await response.text()).slice(0, 1000);
        if (response.status !== 429 && response.status < 500)
          throw new Error(`Notion ${method} ${path} failed (${response.status}): ${detail}`);
        last = new Error(`Notion ${method} ${path} failed (${response.status})`);
      } catch (error) {
        last = error;
      }
      if (attempt < 3) await Bun.sleep(250 * 2 ** (attempt - 1));
    }
    throw last;
  }
}

export const desiredNotionSchema = {
  Action: "title",
  Course: "select",
  Status: "select",
  Availability: "select",
  Weight: "number",
  "Start By": "date",
  Due: "date",
  Source: "url",
  Notes: "rich_text",
} as const;

export const desiredNotionOptions = {
  Status: ["Not started", "In progress", "Done", "Dropped"],
  Availability: ["Locked", "Ready", "Blocked", "Review"],
} as const;

export function planNotionSchema(properties: Record<string, unknown>): {
  add: Array<string>;
  remove: Array<string>;
  wrongType: Array<string>;
  wrongOptions: Array<string>;
} {
  const desired = Object.entries(desiredNotionSchema);
  const add = desired.filter(([name]) => !(name in properties)).map(([name]) => name);
  const wrongType = desired
    .filter(([name, type]) => {
      const property = properties[name] as { type?: string } | undefined;
      return property && property.type !== type;
    })
    .map(([name]) => name);
  const remove = Object.keys(properties).filter((name) => !(name in desiredNotionSchema));
  const wrongOptions = Object.entries(desiredNotionOptions)
    .filter(([name, expected]) => {
      const property = properties[name] as
        | { select?: { options?: Array<{ name?: string }> } }
        | undefined;
      const actual = property?.select?.options?.map((option) => option.name ?? "") ?? [];
      return (
        actual.length !== expected.length || expected.some((option) => !actual.includes(option))
      );
    })
    .map(([name]) => name);
  return { add, remove, wrongType, wrongOptions };
}

export function assertNotionSchema(properties: Record<string, unknown>): void {
  const plan = planNotionSchema(properties);
  const problems = Object.entries(plan).filter(([, values]) => values.length > 0);
  if (problems.length === 0) return;
  throw new Error(
    `Notion schema mismatch: ${problems
      .map(([kind, values]) => `${kind}=${values.join(",")}`)
      .join("; ")}`,
  );
}

export interface NotionOperation {
  type: "create" | "update";
  actionId: string;
  pageId: string | null;
  values: ActionValues;
}

export function planNotionDiff(
  actions: Array<Action>,
  rows: Array<NotionRow>,
): Array<NotionOperation> {
  const byPage = new Map(rows.map((row) => [row.pageId, row]));
  const operations: Array<NotionOperation> = [];
  for (const action of actions) {
    const values = actionValues(action);
    if (values.archived && action.notionPageId && !byPage.has(action.notionPageId)) continue;
    if (!action.notionPageId)
      operations.push({ type: "create", actionId: action.id, pageId: null, values });
    else if (!sameValues(byPage.get(action.notionPageId)?.values, values)) {
      operations.push({ type: "update", actionId: action.id, pageId: action.notionPageId, values });
    }
  }
  return operations;
}

function sameValues(actual: ActionValues | undefined, expected: ActionValues): boolean {
  if (!actual) return false;
  const sameDate = (left: string | null, right: string | null) => {
    if (left === right) return true;
    if (!left || !right) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(left) || /^\d{4}-\d{2}-\d{2}$/.test(right)) return false;
    return new Date(left).getTime() === new Date(right).getTime();
  };
  return (
    actual.action === expected.action &&
    actual.course === expected.course &&
    actual.status === expected.status &&
    actual.availability === expected.availability &&
    actual.weight === expected.weight &&
    sameDate(actual.startBy, expected.startBy) &&
    sameDate(actual.due, expected.due) &&
    actual.source === expected.source &&
    actual.notes === expected.notes &&
    actual.archived === expected.archived
  );
}

export function actionValues(action: Action): ActionValues {
  return {
    action: action.action,
    course: action.course,
    status: action.status,
    availability: action.availability,
    weight: action.weight,
    startBy: action.startBy,
    due: action.due,
    source: action.source,
    notes: action.notes,
    archived: action.archived,
  };
}

function decodePage(page: Record<string, unknown>): NotionRow {
  const properties = (page.properties ?? {}) as Record<string, unknown>;
  return {
    pageId: String(page.id),
    values: {
      action: text(properties.Action),
      course: select(properties.Course),
      status: normalizeStatus(select(properties.Status)),
      availability: normalizeAvailability(
        select(properties.Availability) || select(properties.Readiness),
      ),
      weight: number(properties.Weight),
      startBy: date(properties["Start By"]),
      due: date(properties.Due) ?? date(properties["Official Due"]),
      source: url(properties.Source) ?? url(properties["Source URL"]),
      notes: text(properties.Notes),
      archived: Boolean(page.archived),
    },
  };
}

function encodeValues(value: ActionValues): Record<string, unknown> {
  return {
    Action: { title: rich(value.action) },
    Course: { select: value.course ? { name: value.course } : null },
    Status: { select: { name: value.status } },
    Availability: { select: { name: value.availability } },
    Weight: { number: value.weight },
    "Start By": { date: value.startBy ? { start: value.startBy } : null },
    Due: { date: value.due ? { start: value.due } : null },
    Source: { url: value.source },
    Notes: { rich_text: rich(value.notes) },
  };
}

function rich(value: string): Array<unknown> {
  return value ? [{ type: "text", text: { content: value } }] : [];
}
function text(value: unknown): string {
  const row = (value ?? {}) as Record<string, unknown>;
  const parts = (row.title ?? row.rich_text ?? []) as Array<Record<string, unknown>>;
  return parts.map((part) => String(part.plain_text ?? "")).join("");
}
function select(value: unknown): string {
  return String((value as { select?: { name?: string } | null } | null)?.select?.name ?? "");
}
function date(value: unknown): string | null {
  return (value as { date?: { start?: string } | null } | null)?.date?.start ?? null;
}
function url(value: unknown): string | null {
  return (value as { url?: string | null } | null)?.url ?? null;
}
function number(value: unknown): number | null {
  const result = (value as { number?: number | null } | null)?.number;
  return typeof result === "number" ? result : null;
}
function normalizeStatus(value: string): ActionValues["status"] {
  return value === "In progress" || value === "Done" || value === "Dropped" ? value : "Not started";
}
function normalizeAvailability(value: string): ActionValues["availability"] {
  if (value === "Locked" || value === "Blocked" || value === "Review") return value;
  return "Ready";
}
