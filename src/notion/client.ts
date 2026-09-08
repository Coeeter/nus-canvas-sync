import { Effect, Redacted, Schedule, Schema } from "effect";
import { type HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import type { ExistingAction, ReconcileOperation } from "../reconcile/plan";
import { decodeNotionProperties, encodeNotionProperties, readNotionText } from "./properties";
import { syncPlannerViews } from "./views";

const NOTION_VERSION = "2025-09-03";

const NotionActionPageSchema = Schema.Struct({
  id: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Unknown),
});
const QueryActionsResponseSchema = Schema.Struct({
  results: Schema.Array(NotionActionPageSchema),
  has_more: Schema.Boolean,
  next_cursor: Schema.NullOr(Schema.String),
});
const PageIdResponseSchema = Schema.Struct({ id: Schema.String });
const RichTextPartSchema = Schema.Struct({ plain_text: Schema.optional(Schema.String) });
const BlockSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  callout: Schema.optional(
    Schema.Struct({ rich_text: Schema.optional(Schema.Array(RichTextPartSchema)) }),
  ),
});
const BlockChildrenResponseSchema = Schema.Struct({
  results: Schema.Array(BlockSchema),
  has_more: Schema.Boolean,
  next_cursor: Schema.NullOr(Schema.String),
});

export type NotionActionPage = typeof NotionActionPageSchema.Type;

export class NotionRequestError extends Schema.TaggedError<NotionRequestError>()(
  "NotionRequestError",
  {
    message: Schema.String,
    retryable: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {}

export class NotionClient {
  readonly #token: Redacted.Redacted<string>;

  constructor(
    token: string | Redacted.Redacted<string>,
    readonly dataSourceId: string,
    readonly httpClient: HttpClient.HttpClient,
  ) {
    this.#token = typeof token === "string" ? Redacted.make(token) : token;
  }

  queryActions() {
    return queryActions(this);
  }

  syncPlannerViews(now: Date) {
    return syncPlannerViews(this, now);
  }

  listExistingActions(): Effect.Effect<Array<ExistingAction>, unknown> {
    return this.queryActions().pipe(
      Effect.map((pages) =>
        pages.map((page) => ({
          id: page.id,
          automatedIdentity: readNotionText(page.properties["Canvas Item ID"]),
          properties: decodeNotionProperties(page.properties),
        })),
      ),
    );
  }

  applyAndVerify(operation: ReconcileOperation) {
    return applyAndVerify(this, operation);
  }

  updateHealthBlock(blockId: string, message: string) {
    return this.call(`/v1/blocks/${blockId}`, "PATCH", {
      callout: { rich_text: [{ type: "text", text: { content: message } }] },
    }).pipe(Effect.asVoid);
  }

  findHealthBlock(pageId: string) {
    return findHealthBlock(this, pageId);
  }

  getPage(pageId: string) {
    return this.call(`/v1/pages/${pageId}`).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(NotionActionPageSchema)),
      Effect.mapError(toNotionError("GET", `/v1/pages/${pageId}`)),
    );
  }

  createPage(properties: Record<string, unknown>) {
    return this.call("/v1/pages", "POST", {
      parent: { data_source_id: this.dataSourceId },
      properties,
    }).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(PageIdResponseSchema)),
      Effect.map((payload) => payload.id),
      Effect.mapError(toNotionError("POST", "/v1/pages")),
    );
  }

  updatePage(pageId: string, properties: Record<string, unknown>) {
    const requestPath = `/v1/pages/${pageId}`;
    return this.call(requestPath, "PATCH", { properties }).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(PageIdResponseSchema)),
      Effect.map((payload) => payload.id),
      Effect.mapError(toNotionError("PATCH", requestPath)),
    );
  }

  call(path: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown) {
    return call(this, path, method, body);
  }

  request(path: string, method: "GET" | "POST" | "PATCH", body?: unknown) {
    const request = HttpClientRequest.make(method)(`https://api.notion.com${path}`).pipe(
      HttpClientRequest.bearerToken(this.#token),
      HttpClientRequest.setHeader("Notion-Version", NOTION_VERSION),
      HttpClientRequest.acceptJson,
    );
    const withBody =
      body === undefined ? Effect.succeed(request) : HttpClientRequest.bodyJson(request, body);
    return withBody.pipe(
      Effect.flatMap(this.httpClient.execute),
      Effect.mapError(toNotionError(method, path)),
    );
  }
}

const queryActions = Effect.fn("NotionClient.queryActions")(function* (client: NotionClient) {
  const pages: Array<NotionActionPage> = [];
  let cursor: string | undefined;
  do {
    const body = cursor ? { start_cursor: cursor } : {};
    const payload = yield* client
      .call(`/v1/data_sources/${client.dataSourceId}/query`, "POST", body)
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(QueryActionsResponseSchema)));
    pages.push(...payload.results);
    cursor = payload.has_more ? (payload.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return pages;
});

const applyAndVerify = Effect.fn("NotionClient.applyAndVerify")(function* (
  client: NotionClient,
  operation: ReconcileOperation,
) {
  const encodedProperties = yield* Effect.try({
    try: () => encodeNotionProperties(operation.properties),
    catch: (cause) =>
      new NotionRequestError({
        message: `Failed to encode Notion properties for ${operation.identity}`,
        retryable: false,
        cause,
      }),
  });
  if (operation.type === "update") yield* client.getPage(operation.pageId);
  const pageId =
    operation.type === "create"
      ? yield* client.createPage(encodedProperties)
      : yield* client.updatePage(operation.pageId, encodedProperties);
  const verified = yield* client.getPage(pageId);
  const identity = readNotionText(verified.properties["Canvas Item ID"]);
  if (!verified.id || identity !== operation.identity) {
    return yield* new NotionRequestError({
      message: `Notion verification failed for ${operation.identity}`,
      retryable: false,
      cause: operation.identity,
    });
  }
  return verified;
});

const findHealthBlock = Effect.fn("NotionClient.findHealthBlock")(function* (
  client: NotionClient,
  pageId: string,
) {
  let cursor: string | undefined;
  do {
    const query = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : "";
    const requestPath = `/v1/blocks/${pageId}/children${query}`;
    const payload = yield* client
      .call(requestPath)
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(BlockChildrenResponseSchema)));
    for (const block of payload.results) {
      const text = block.callout?.rich_text?.map((part) => part.plain_text ?? "").join("") ?? "";
      if (
        block.type === "callout" &&
        /^(?:Legacy automation paused:|LAST SYNC FAILED|All \d+ courses successfully synced)/i.test(
          text,
        )
      ) {
        return block.id;
      }
    }
    cursor = payload.has_more ? (payload.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return yield* new NotionRequestError({
    message: "Notion sync-health callout was not found",
    retryable: false,
    cause: pageId,
  });
});

const callAttempt = Effect.fn("NotionClient.call")(function* (
  client: NotionClient,
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
) {
  const response = yield* client.request(path, method, body);
  if (response.status >= 200 && response.status < 300) return response;
  return yield* new NotionRequestError({
    message: `Notion ${method} ${path} failed (${response.status})`,
    retryable: response.status === 429 || response.status >= 500,
    cause: response.status,
  });
});

const call = (
  client: NotionClient,
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
) =>
  callAttempt(client, path, method, body).pipe(
    Effect.retry(($) =>
      $(Schedule.max([Schedule.exponential("250 millis"), Schedule.recurs(2)])).pipe(
        Schedule.while(({ input }) => input.retryable),
      ),
    ),
  );

function toNotionError(method: string, path: string) {
  return (cause: unknown) =>
    cause instanceof NotionRequestError
      ? cause
      : new NotionRequestError({
          message: `Notion ${method} ${path} failed`,
          retryable: false,
          cause,
        });
}
