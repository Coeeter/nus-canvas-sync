import type { ExistingAction, ReconcileOperation } from "../reconcile/plan";
import { decodeNotionProperties, encodeNotionProperties, readNotionText } from "./properties";

const NOTION_VERSION = "2025-09-03";

export interface NotionActionPage {
  id: string;
  properties: Record<string, unknown>;
}

export class NotionClient {
  constructor(
    private readonly token: string,
    private readonly dataSourceId: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async queryActions(): Promise<Array<NotionActionPage>> {
    const pages: Array<NotionActionPage> = [];
    let cursor: string | undefined;
    do {
      const body = cursor ? { start_cursor: cursor } : {};
      const response = await this.call(`/v1/data_sources/${this.dataSourceId}/query`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        results: Array<NotionActionPage>;
        has_more: boolean;
        next_cursor: string | null;
      };
      pages.push(...payload.results);
      cursor = payload.has_more ? (payload.next_cursor ?? undefined) : undefined;
    } while (cursor);
    return pages;
  }

  async listExistingActions(): Promise<Array<ExistingAction>> {
    return (await this.queryActions()).map((page) => ({
      id: page.id,
      automatedIdentity: readNotionText(page.properties["Canvas Item ID"]),
      properties: decodeNotionProperties(page.properties),
    }));
  }

  async applyAndVerify(operation: ReconcileOperation) {
    const encodedProperties = encodeNotionProperties(operation.properties);
    if (operation.type === "update") await this.getPage(operation.pageId);
    const pageId =
      operation.type === "create"
        ? await this.createPage(encodedProperties)
        : await this.updatePage(operation.pageId, encodedProperties);
    const verified = await this.getPage(pageId);
    const identity = readNotionText(verified.properties["Canvas Item ID"]);
    if (!verified?.id || identity !== operation.identity) {
      throw new Error(`Notion verification failed for ${operation.identity}`);
    }
    return verified;
  }

  async updateHealthBlock(blockId: string, message: string) {
    await this.call(`/v1/blocks/${blockId}`, {
      method: "PATCH",
      body: JSON.stringify({
        callout: { rich_text: [{ type: "text", text: { content: message } }] },
      }),
    });
  }

  async findHealthBlock(pageId: string) {
    let cursor: string | undefined;
    do {
      const query = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : "";
      const response = await this.call(`/v1/blocks/${pageId}/children${query}`);
      const payload = (await response.json()) as {
        results: Array<{
          id: string;
          type: string;
          callout?: { rich_text?: Array<{ plain_text?: string }> };
        }>;
        has_more: boolean;
        next_cursor: string | null;
      };
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
    throw new Error("Notion sync-health callout was not found");
  }

  async getPage(pageId: string): Promise<NotionActionPage> {
    const response = await this.call(`/v1/pages/${pageId}`);
    return (await response.json()) as NotionActionPage;
  }

  private async createPage(properties: Record<string, unknown>) {
    const response = await this.call("/v1/pages", {
      method: "POST",
      body: JSON.stringify({ parent: { data_source_id: this.dataSourceId }, properties }),
    });
    return ((await response.json()) as { id: string }).id;
  }

  private async updatePage(pageId: string, properties: Record<string, unknown>) {
    const response = await this.call(`/v1/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    return ((await response.json()) as { id: string }).id;
  }

  private async call(path: string, init: RequestInit = {}) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.request(`https://api.notion.com${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "Notion-Version": NOTION_VERSION,
        },
      });
      if (response.ok) return response;
      if ((response.status !== 429 && response.status < 500) || attempt === 2) {
        throw new Error(`Notion ${init.method ?? "GET"} ${path} failed (${response.status})`);
      }
      await Bun.sleep(250 * 2 ** attempt);
    }
    throw new Error("Notion request failed");
  }
}
