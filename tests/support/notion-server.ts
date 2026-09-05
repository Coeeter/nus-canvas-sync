import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { decodeNotionProperties, encodeNotionProperties } from "../../src/notion/properties";

export function notionServer() {
  const pages = new Map<
    string,
    { id: string; archived: boolean; properties: Record<string, unknown> }
  >();
  const views = new Map<string, Record<string, unknown>>();
  let creates = 0;
  let commitThenFail = false;
  let failBeforeCreate = false;
  let omitSavedProperty: string | undefined;
  let beforePatchRead: (() => void) | undefined;
  const hydrate = (properties: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(properties).map(([name, raw]) => {
        const value = structuredClone(raw) as Record<string, unknown>;
        for (const key of ["rich_text", "title"])
          if (Array.isArray(value[key]))
            value[key] = value[key].map((part: { text: { content: string } }) => ({
              ...part,
              plain_text: part.text.content,
            }));
        return [name, value];
      }),
    );
  const put = (id: string, properties: Record<string, unknown>) =>
    pages.set(id, { id, archived: false, properties: hydrate(encodeNotionProperties(properties)) });
  const http = HttpClient.make((request, url) => {
    const body =
      request.body._tag === "Uint8Array"
        ? JSON.parse(new TextDecoder().decode(request.body.body))
        : {};
    let result: unknown;
    let status = 200;
    if (url.pathname.startsWith("/v1/views/")) {
      const id = url.pathname.split("/").at(-1)!;
      const view = views.get(id) ?? { id, filter: null, sorts: null };
      if (request.method === "PATCH") Object.assign(view, body);
      views.set(id, view);
      result = view;
    } else if (url.pathname.startsWith("/v1/data_sources/") && request.method === "GET")
      result = { properties: {} };
    else if (url.pathname.endsWith("/query"))
      result = {
        results: [...pages.values()].filter((page) => !page.archived),
        has_more: false,
        next_cursor: null,
      };
    else if (url.pathname === "/v1/pages" && request.method === "POST") {
      creates++;
      if (failBeforeCreate) {
        result = {};
        status = 500;
      } else {
        const id = `page-${creates}`;
        const properties = hydrate(body.properties);
        if (omitSavedProperty) delete properties[omitSavedProperty];
        pages.set(id, { id, archived: false, properties });
        result = { id };
        status = commitThenFail ? 500 : 200;
      }
    } else if (url.pathname.startsWith("/v1/pages/")) {
      if (request.method === "GET") {
        beforePatchRead?.();
        beforePatchRead = undefined;
      }
      const page = pages.get(url.pathname.split("/").at(-1)!);
      if (!page) {
        status = 404;
        result = {};
      } else {
        if (request.method === "PATCH") {
          page.properties = { ...page.properties, ...hydrate(body.properties) };
          page.archived = body.archived ?? page.archived;
        }
        result = page;
      }
    } else result = { id: "health" };
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(JSON.stringify(result), { status })),
    );
  });
  return {
    http,
    pages,
    views,
    put,
    values: () =>
      [...pages.values()].map((page) => ({
        ...page,
        properties: decodeNotionProperties(page.properties),
      })),
    get creates() {
      return creates;
    },
    set commitThenFail(value: boolean) {
      commitThenFail = value;
    },
    set failBeforeCreate(value: boolean) {
      failBeforeCreate = value;
    },
    set omitSavedProperty(value: string | undefined) {
      omitSavedProperty = value;
    },
    set beforePatchRead(value: (() => void) | undefined) {
      beforePatchRead = value;
    },
  };
}
