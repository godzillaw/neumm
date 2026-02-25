import axios from 'axios';
import * as cheerio from 'cheerio';

// ─── Confluence API client ────────────────────────────────────────────────────

function getConfluenceApi() {
  const domain = process.env.CONFLUENCE_DOMAIN;
  const email = process.env.CONFLUENCE_EMAIL;
  const token = process.env.CONFLUENCE_API_TOKEN;

  if (!domain || !email || !token) {
    throw new Error(
      'Missing Confluence credentials: CONFLUENCE_DOMAIN, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN required'
    );
  }

  return axios.create({
    baseURL: `https://${domain}/wiki/rest/api`,
    auth: { username: email, password: token },
    headers: { Accept: 'application/json' },
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConfluencePage {
  id: string;
  title: string;
  content: string;
  space: string;
  updated: string;
  author: string;
  url: string;
}

export interface ConfluenceSpaceInfo {
  key: string;
  name: string;
  description: string;
}

// ─── Fetch pages in a space ───────────────────────────────────────────────────

export async function fetchConfluenceData(spaceKey: string): Promise<ConfluencePage[]> {
  const confluenceApi = getConfluenceApi();

  const { data } = await confluenceApi.get('/content', {
    params: {
      spaceKey,
      type: 'page',
      expand: 'body.storage,version,history',
      limit: 100,
      status: 'current',
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results as any[]).map((page) => {
    // Convert Confluence storage-format HTML to plain text via cheerio
    const rawHtml = page.body?.storage?.value || '';
    const $ = cheerio.load(rawHtml);
    const plainText = $.text().replace(/\s+/g, ' ').trim().slice(0, 4000);

    return {
      id: page.id,
      title: page.title,
      content: plainText,
      space: spaceKey,
      updated: page.version?.when || new Date().toISOString(),
      author: page.history?.createdBy?.displayName || 'Unknown',
      url: `https://${process.env.CONFLUENCE_DOMAIN}/wiki${page._links?.webui || ''}`,
    };
  });
}

// ─── Get space metadata ───────────────────────────────────────────────────────

export async function getSpaceInfo(spaceKey: string): Promise<ConfluenceSpaceInfo | null> {
  try {
    const confluenceApi = getConfluenceApi();
    const { data } = await confluenceApi.get(`/space/${spaceKey}`);
    return {
      key: data.key,
      name: data.name,
      description: data.description?.plain?.value || '',
    };
  } catch (err) {
    console.error('[Confluence] Failed to get space info:', err);
    return null;
  }
}
