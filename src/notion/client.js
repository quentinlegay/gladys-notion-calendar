// -----------------------------------------------------------------------------
// Minimal Notion REST client (https://developers.notion.com/reference).
//
// Notion Calendar has no public API of its own: it displays the Notion
// databases that have a date property. This client reads those databases —
// "data sources" since the 2025-09-03 version of the API, a database holding
// one or more of them — with the token of a Notion internal integration.
//
// No dependency: the global fetch of Node 22+. `fetch` is injectable so the
// tests never touch the network.
// -----------------------------------------------------------------------------

export const NOTION_API_URL = 'https://api.notion.com/v1';
export const NOTION_VERSION = '2025-09-03';

// Notion answers 100 results per page at most.
const PAGE_SIZE = 100;
// Notion allows about 3 requests per second per integration and answers 429
// beyond, with a Retry-After header: wait and retry a few times.
const MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 1;
const REQUEST_TIMEOUT_MS = 30_000;
// A runaway pagination (a cursor that never ends) must not loop forever.
const MAX_PAGES = 100;

export class NotionApiError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code Notion error code (`unauthorized`, `object_not_found`...)
   * @param {string} message Notion error message
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'NotionApiError';
    this.status = status;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class NotionClient {
  /**
   * @param {string} token secret of a Notion internal integration
   * @param {{ fetch?: typeof fetch, sleep?: (ms: number) => Promise<void> }} [options]
   */
  constructor(token, { fetch: fetchImpl = globalThis.fetch, sleep: sleepImpl = sleep } = {}) {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('A Notion token is required');
    }
    this.token = token;
    this.fetch = fetchImpl;
    this.sleep = sleepImpl;
  }

  async request(method, path, body) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetch(`${NOTION_API_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        const seconds =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_SECONDS;
        await this.sleep(seconds * 1000);
        continue;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new NotionApiError(
          response.status,
          payload.code ?? 'unknown_error',
          payload.message ?? `Notion API answered ${response.status}`,
        );
      }
      return payload;
    }
  }

  // Follow `next_cursor` until the end, `body` being the POST body of the
  // paginated endpoint.
  async paginate(path, body = {}) {
    const results = [];
    let cursor;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const payload = await this.request('POST', path, {
        ...body,
        page_size: PAGE_SIZE,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      results.push(...(payload.results ?? []));
      if (!payload.has_more || !payload.next_cursor) {
        return results;
      }
      cursor = payload.next_cursor;
    }
    return results;
  }

  /** The bot user of the token: the cheapest call to check it. */
  me() {
    return this.request('GET', '/users/me');
  }

  /** Every data source shared with the integration. */
  searchDataSources() {
    return this.paginate('/search', { filter: { property: 'object', value: 'data_source' } });
  }

  /** A database, with the list of its data sources (`data_sources: [{ id, name }]`). */
  getDatabase(databaseId) {
    return this.request('GET', `/databases/${encodeURIComponent(databaseId)}`);
  }

  /** A data source, with its properties schema. */
  getDataSource(dataSourceId) {
    return this.request('GET', `/data_sources/${encodeURIComponent(dataSourceId)}`);
  }

  /** Every page of a data source matching `filter`. */
  queryDataSource(dataSourceId, filter) {
    return this.paginate(`/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
      ...(filter ? { filter } : {}),
    });
  }

  /** Create a page (a row) in a data source. */
  createPage(dataSourceId, properties) {
    return this.request('POST', '/pages', {
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties,
    });
  }
}
