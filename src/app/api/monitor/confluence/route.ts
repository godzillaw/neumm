import { NextResponse } from 'next/server';
import { fetchConfluenceData } from '@/lib/integrations/confluence';
import { db } from '@/lib/db';

// ─── POST /api/monitor/confluence — fetch & store Confluence pages ────────────

export async function POST(request: Request) {
  try {
    const body = await request.json() as { spaceKey?: string };
    const { spaceKey } = body;

    if (!spaceKey) {
      return NextResponse.json(
        { error: 'Space key required (e.g., "TECH")' },
        { status: 400 }
      );
    }

    console.log(`[Confluence] Fetching data for space ${spaceKey}...`);

    const pages = await fetchConfluenceData(spaceKey);

    console.log(`[Confluence] Fetched ${pages.length} pages`);

    for (const page of pages) {
      db.run(
        `INSERT OR REPLACE INTO confluence_pages
          (id, title, content, space, updated, author, url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          page.id,
          page.title,
          page.content,
          page.space,
          page.updated,
          page.author,
          page.url,
        ]
      );
    }

    return NextResponse.json({
      success: true,
      spaceKey,
      pages: pages.length,
    });

  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Confluence] Monitoring error:', err.message);
    return NextResponse.json(
      { error: 'Failed to fetch Confluence data', message: err.message },
      { status: 500 }
    );
  }
}

// ─── GET /api/monitor/confluence — return stored pages ───────────────────────

export async function GET() {
  try {
    const pages = db.all<{
      id: string; title: string; content: string; space: string;
      updated: string; author: string; url: string; created_at: string;
    }>(`SELECT * FROM confluence_pages ORDER BY updated DESC LIMIT 100`);

    const domain = process.env.CONFLUENCE_DOMAIN || '';
    const email = process.env.CONFLUENCE_EMAIL || '';
    const token = process.env.CONFLUENCE_API_TOKEN || '';
    const isConfigured = !!(
      domain && !domain.includes('your-company') &&
      email && !email.includes('your-email') &&
      token && token.length > 8
    );

    return NextResponse.json({
      status: isConfigured ? 'connected' : 'not_configured',
      success: true,
      pages,
      count: pages.length,
    });

  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Confluence] Query error:', err.message);
    return NextResponse.json(
      { error: 'Failed to query Confluence pages', message: err.message },
      { status: 500 }
    );
  }
}
