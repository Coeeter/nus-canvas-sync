import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import { contentHash } from "../normalize/hash";
import type { NotionClient } from "./client";

export const PLANNER_VIEWS = {
  urgent: "3bd703fb-987d-81cb-8ea1-000c442ee0f9",
  active: "3bd703fb-987d-81d7-8075-000c4389a2bb",
  review: "3bd703fb-987d-8177-addf-000c14d49379",
} as const;

export function plannerViewDefinitions(now: Date) {
  const singaporeNow = new Date(now.getTime() + 8 * 3600_000);
  const today = singaporeNow.toISOString().slice(0, 10);
  const cutoff = new Date(singaporeNow.getTime() + 3 * 86400_000).toISOString().slice(0, 10);
  const nonterminal = ["Done", "Dropped"].map((status) => ({
    property: "Status",
    select: { does_not_equal: status },
  }));
  const active = [
    ...nonterminal,
    { property: "Needs Review", checkbox: { equals: false } },
    { property: "Source State", select: { does_not_equal: "Missing" } },
    { property: "Blocked By", rich_text: { is_empty: true } },
    ...["Later", "Locked", "Waiting on prerequisite"].map((state) => ({
      property: "Readiness",
      select: { does_not_equal: state },
    })),
    {
      or: [
        { property: "Available From", date: { is_empty: true } },
        { property: "Available From", date: { on_or_before: today } },
        { property: "Readiness", select: { equals: "Scheduled" } },
      ],
    },
  ];
  return {
    urgent: {
      filter: {
        and: [
          ...active,
          {
            or: [
              { property: "Official Due", date: { on_or_before: cutoff } },
              { property: "Planned", date: { on_or_before: cutoff } },
            ],
          },
        ],
      },
      sorts: [
        { property: "Planned", direction: "ascending" },
        { property: "Official Due", direction: "ascending" },
      ],
    },
    active: {
      filter: {
        and: [
          ...active,
          {
            or: [
              { property: "Readiness", select: { equals: "Ready" } },
              { property: "Status", select: { equals: "Doing" } },
              { property: "Readiness", select: { equals: "Scheduled" } },
            ],
          },
          {
            or: [
              { property: "Readiness", select: { does_not_equal: "Scheduled" } },
              { property: "Official Due", date: { on_or_before: cutoff } },
            ],
          },
        ],
      },
      sorts: [
        { property: "Planned", direction: "ascending" },
        { property: "Official Due", direction: "ascending" },
      ],
    },
    review: {
      filter: { and: [...nonterminal, { property: "Needs Review", checkbox: { equals: true } }] },
      sorts: [{ property: "Official Due", direction: "ascending" }],
    },
  };
}

const ViewSchema = Schema.Struct({
  id: Schema.String,
  filter: Schema.Unknown,
  sorts: Schema.Unknown,
});

export const syncPlannerViews = Effect.fn("NotionClient.syncPlannerViews")(function* (
  client: NotionClient,
  now: Date,
) {
  const schema = yield* client.call(`/v1/data_sources/${client.dataSourceId}`).pipe(
    Effect.flatMap(
      HttpClientResponse.schemaBodyJson(
        Schema.Struct({
          properties: Schema.Record(Schema.String, Schema.Struct({ id: Schema.String })),
        }),
      ),
    ),
  );
  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          key === "property" && typeof item === "string" && schema.properties[item]
            ? decodeURIComponent(schema.properties[item].id)
            : resolve(item),
        ]),
      );
    }
    return value;
  };
  const definitions = plannerViewDefinitions(now);
  for (const [name, id] of Object.entries(PLANNER_VIEWS)) {
    const path = `/v1/views/${id}`;
    const desired = resolve(definitions[name as keyof typeof definitions]) as Record<
      string,
      unknown
    >;
    const before = yield* client
      .call(path)
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(ViewSchema)));
    if (contentHash({ filter: before.filter, sorts: before.sorts }) === contentHash(desired)) {
      continue;
    }
    yield* client.call(path, "PATCH", desired);
    const saved = yield* client
      .call(path)
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(ViewSchema)));
    if (
      saved.id !== id ||
      contentHash({ filter: saved.filter, sorts: saved.sorts }) !== contentHash(desired)
    ) {
      return yield* Effect.fail(new Error(`Planner view verification failed: ${name}`));
    }
  }
});
