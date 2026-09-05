import { createHash } from "node:crypto";
import { join } from "node:path";
import { Effect, FileSystem, Redacted, Schedule, Schema } from "effect";
import { type HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import type { ExistingAction, ReconcileOperation } from "../reconcile/plan";
import { AGENT_OWNED_FIELDS } from "../reconcile/plan";
import { writeJsonAtomic } from "../state/atomic";
import {
  decodeNotionProperties,
  encodeNotionProperties,
  mergeManagedNotes,
  readNotionText,
} from "./properties";
import { syncPlannerViews } from "./views";

const NOTION_VERSION = "2025-09-03";

const NotionActionPageSchema = Schema.Struct({
  id: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Unknown),
  archived: Schema.optional(Schema.Boolean),
  last_edited_time: Schema.optional(Schema.String),
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
    readonly dataDir?: string,
  ) {
    this.#token = typeof token === "string" ? Redacted.make(token) : token;
  }

  syncPlannerViews(now: Date) {
    return syncPlannerViews(this, now);
  }

  queryActions() {
    return queryActions(this).pipe(Effect.timeout("2 minutes"));
  }

  listExistingActions(recoveryPageIds: ReadonlyArray<string> = []) {
    return Effect.gen({ self: this }, function* () {
      const pages = yield* this.queryActions();
      for (const id of new Set(recoveryPageIds))
        if (!pages.some((page) => page.id === id)) pages.push(yield* this.getPage(id));
      return pages.map(
        (page): ExistingAction => ({
          id: page.id,
          automatedIdentity: readNotionText(page.properties["Canvas Item ID"]),
          properties: decodeNotionProperties(page.properties),
          archived: page.archived ?? false,
          ...(page.last_edited_time ? { editedAt: page.last_edited_time } : {}),
        }),
      );
    });
  }

  validateSchema() {
    return this.call(`/v1/data_sources/${this.dataSourceId}`).pipe(
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(
          Schema.Struct({
            properties: Schema.Record(Schema.String, Schema.Struct({ type: Schema.String })),
          }),
        ),
      ),
      Effect.flatMap((schema) => {
        const expected: Record<string, string> = {
          Action: "title",
          Status: "select",
          Readiness: "select",
          Course: "select",
          Type: "select",
          "Work Mode": "select",
          "Source State": "select",
          "Canvas Item ID": "rich_text",
          "Canvas Item Type": "rich_text",
          "Canvas Course ID": "rich_text",
          "Parent Canvas ID": "rich_text",
          Notes: "rich_text",
          "Blocked By": "rich_text",
          "Needs Review": "checkbox",
          Pinned: "checkbox",
          "Missing Syncs": "number",
          "Official Due": "date",
          "Available From": "date",
          "Last Synced": "date",
          "Start By": "date",
          Planned: "date",
          "Source URL": "url",
        };
        const mismatches = Object.entries(expected)
          .filter(([name, type]) => schema.properties[name]?.type !== type)
          .map(([name]) => name);
        return mismatches.length
          ? Effect.fail(new Error(`Notion schema mismatch: ${mismatches.join(", ")}`))
          : Effect.void;
      }),
    );
  }

  applyAndVerify(operation: ReconcileOperation) {
    return applyAndVerify(this, operation).pipe(Effect.timeout("2 minutes"));
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

  updatePage(pageId: string, properties: Record<string, unknown>, archived = false) {
    const requestPath = `/v1/pages/${pageId}`;
    return this.call(requestPath, "PATCH", { properties, archived }).pipe(
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
      HttpClientRequest.setHeader(
        "Notion-Version",
        path.startsWith("/v1/views") ? "2026-03-11" : NOTION_VERSION,
      ),
      HttpClientRequest.acceptJson,
    );
    const withBody =
      body === undefined ? Effect.succeed(request) : HttpClientRequest.bodyJson(request, body);
    return withBody.pipe(
      Effect.flatMap(this.httpClient.execute),
      Effect.timeout("30 seconds"),
      Effect.mapError(toNotionError(method, path)),
    );
  }
}

const queryActions = Effect.fn("NotionClient.queryActions")(function* (client: NotionClient) {
  const pages: Array<NotionActionPage> = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const body = cursor ? { start_cursor: cursor } : {};
    const payload = yield* client
      .call(`/v1/data_sources/${client.dataSourceId}/query`, "POST", body)
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(QueryActionsResponseSchema)));
    pages.push(...payload.results);
    if (payload.has_more && (!payload.next_cursor || cursors.has(payload.next_cursor)))
      return yield* verificationFailure("query", "invalid or repeated pagination cursor");
    cursor = payload.has_more ? (payload.next_cursor ?? undefined) : undefined;
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return pages;
});

const applyAndVerify = Effect.fn("NotionClient.applyAndVerify")(function* (
  client: NotionClient,
  operation: ReconcileOperation,
) {
  const properties = { ...operation.properties };
  if (operation.type === "update") {
    const current = yield* client.getPage(operation.pageId);
    const actual = decodeNotionProperties(current.properties);
    if (
      !readNotionText(current.properties["Canvas Item ID"]) ||
      readNotionText(current.properties["Canvas Item ID"]) !==
        (operation.expectedIdentity ?? operation.identity)
    )
      return yield* verificationFailure(operation.identity, "ownership changed before update");
    if (operation.expectedProperties) {
      for (const name of [
        "Status",
        "Pinned",
        "Needs Review",
        "Official Due",
        "Available From",
        "Planned",
        "Canvas Course ID",
        "Canvas Item Type",
      ]) {
        if (!equalValue(actual[name], operation.expectedProperties[name]))
          return yield* verificationFailure(operation.identity, `concurrent edit to ${name}`);
      }
    }
    for (const name of Object.keys(properties))
      if (
        !(AGENT_OWNED_FIELDS as ReadonlyArray<string>).includes(name) &&
        name !== "Status" &&
        name !== "Planned"
      )
        return yield* verificationFailure(operation.identity, `unowned property ${name}`);
    if (actual.Status === "Done" || actual.Status === "Dropped") {
      delete properties.Status;
      properties.Readiness = actual.Status === "Done" ? "Completed" : "Later";
      properties["Needs Review"] = false;
    }
    if (actual.Pinned === true) delete properties.Planned;
    if (operation.managedNotes)
      properties.Notes = mergeManagedNotes(actual.Notes, operation.managedNotes);
  } else if (properties.Notes) properties.Notes = mergeManagedNotes(null, String(properties.Notes));
  const encoded = yield* Effect.try(() => encodeNotionProperties(properties));
  let pageId: string;
  if (operation.type === "create") {
    const matches = (yield* client.queryActions()).filter(
      (page) => readNotionText(page.properties["Canvas Item ID"]) === operation.identity,
    );
    if (matches.length > 1)
      return yield* verificationFailure(operation.identity, "duplicate identity");
    const fs = client.dataDir ? yield* FileSystem.FileSystem : undefined;
    const pending = client.dataDir
      ? join(
          client.dataDir,
          "pending-creates",
          `${createHash("sha256").update(operation.identity).digest("hex")}.json`,
        )
      : undefined;
    if (matches[0]) {
      // A previous request may have committed. Replan from that row on the
      // next run rather than overwriting any edits made since its creation.
      if (pending && fs) yield* fs.remove(pending, { force: true });
      return yield* verificationFailure(
        operation.identity,
        "page already exists; retry from fresh Notion state",
      );
    }
    if (pending && fs) {
      if (yield* fs.exists(pending))
        return yield* verificationFailure(
          operation.identity,
          "unresolved create intent; verify the previous request before retrying",
        );
      yield* writeJsonAtomic(pending, { identity: operation.identity });
    }
    const attempt = yield* client.createPage(encoded).pipe(Effect.result);
    if (attempt._tag === "Failure") {
      const recovered = (yield* client.queryActions()).filter(
        (page) => readNotionText(page.properties["Canvas Item ID"]) === operation.identity,
      );
      if (recovered.length !== 1) return yield* Effect.fail(attempt.failure);
      pageId = recovered[0]!.id;
    } else pageId = attempt.success;
    const verified = yield* verifyProperties(client, pageId, operation.identity, properties, false);
    if (pending && fs) yield* fs.remove(pending, { force: true });
    return verified;
  }
  pageId = yield* client.updatePage(operation.pageId, encoded, operation.archived ?? false);
  return yield* verifyProperties(
    client,
    pageId,
    operation.identity,
    properties,
    operation.archived ?? false,
  );
});

const verifyProperties = Effect.fn("NotionClient.verifyProperties")(function* (
  client: NotionClient,
  pageId: string,
  identity: string,
  expected: Record<string, unknown>,
  archived: boolean,
) {
  const verified = yield* client.getPage(pageId);
  const actual = decodeNotionProperties(verified.properties);
  if (
    actual["Canvas Item ID"] !== identity ||
    (verified.archived ?? false) !== archived ||
    Object.entries(expected).some(([name, value]) => !equalValue(actual[name], value))
  )
    return yield* verificationFailure(identity, "saved properties differ from requested values");
  return verified;
});

function verificationFailure(identity: string, reason: string) {
  return new NotionRequestError({
    message: `Notion verification failed for ${identity}: ${reason}`,
    retryable: false,
    cause: reason,
  });
}
function equalValue(left: unknown, right: unknown) {
  if (
    typeof left === "string" &&
    typeof right === "string" &&
    left.includes("T") &&
    right.includes("T") &&
    Number.isFinite(Date.parse(left)) &&
    Number.isFinite(Date.parse(right))
  )
    return Date.parse(left) === Date.parse(right);
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

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
        Schedule.while(
          ({ input }) => input.retryable && !(method === "POST" && path === "/v1/pages"),
        ),
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
