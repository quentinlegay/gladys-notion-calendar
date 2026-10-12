// A Notion workspace in memory, behind the same methods as NotionClient, so
// the sync engine runs against it without touching the network.

import { NotionApiError } from '../../src/notion/client.js';

export const TOKEN = 'ntn_test_token';

export function dataSource(id, title, { dateProperty = 'Date', extra = {} } = {}) {
  return {
    object: 'data_source',
    id,
    title: [{ plain_text: title }],
    properties: {
      Name: { id: 'title', name: 'Name', type: 'title' },
      [dateProperty]: { id: 'date', name: dateProperty, type: 'date' },
      ...extra,
    },
  };
}

export function page(id, name, date, { dateProperty = 'Date', properties = {}, ...rest } = {}) {
  return {
    object: 'page',
    id,
    url: `https://www.notion.so/${id.replaceAll('-', '')}`,
    in_trash: false,
    properties: {
      Name: { type: 'title', title: [{ plain_text: name }] },
      [dateProperty]: { type: 'date', date },
      ...properties,
    },
    ...rest,
  };
}

export class FakeNotion {
  constructor() {
    // id -> { source, pages }
    this.sources = new Map();
    // database id -> [data source ids]
    this.databases = new Map();
    this.created = [];
    this.queries = [];
  }

  add(source, pages = [], databaseId) {
    this.sources.set(source.id, { source, pages });
    if (databaseId) {
      this.databases.set(databaseId, [...(this.databases.get(databaseId) ?? []), source.id]);
    }
    return this;
  }

  pages(sourceId) {
    return this.sources.get(sourceId).pages;
  }

  // Same signature as the factory the sync engine takes.
  createClient = (token) => {
    if (token !== TOKEN) {
      const refuse = async () => {
        throw new NotionApiError(401, 'unauthorized', 'API token is invalid.');
      };
      return {
        me: refuse,
        searchDataSources: refuse,
        getDatabase: refuse,
        getDataSource: refuse,
        queryDataSource: refuse,
        createPage: refuse,
      };
    }
    return this;
  };

  async me() {
    return { object: 'user', type: 'bot' };
  }

  async searchDataSources() {
    return [...this.sources.values()].map(({ source }) => source);
  }

  async getDatabase(id) {
    if (!this.databases.has(id)) {
      throw new NotionApiError(404, 'object_not_found', `Could not find database with ID: ${id}.`);
    }
    return {
      object: 'database',
      id,
      data_sources: this.databases.get(id).map((dsId) => ({ id: dsId })),
    };
  }

  async getDataSource(id) {
    if (!this.sources.has(id)) {
      throw new NotionApiError(
        404,
        'object_not_found',
        `Could not find data source with ID: ${id}.`,
      );
    }
    return this.sources.get(id).source;
  }

  async queryDataSource(id, filter) {
    this.queries.push({ id, filter });
    return this.sources.get(id).pages;
  }

  async createPage(dataSourceId, properties) {
    const id = `0000000${this.created.length}-0000-4000-8000-000000000000`;
    const titleKey = Object.keys(properties).find((key) => properties[key].title);
    const dateKey = Object.keys(properties).find((key) => properties[key].date);
    const created = page(id, properties[titleKey].title[0].text.content, properties[dateKey].date, {
      dateProperty: dateKey,
    });
    this.created.push({ dataSourceId, properties });
    this.sources.get(dataSourceId).pages.push(created);
    return created;
  }
}
