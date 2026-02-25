import { NextResponse } from 'next/server';
import { fetchJiraData } from '@/lib/integrations/jira';
import { db } from '@/lib/db';

// ─── POST /api/monitor/jira — fetch & store Jira issues ──────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json() as { projectKey?: string };
    const { projectKey } = body;

    if (!projectKey) {
      return NextResponse.json(
        { error: 'Project key required (e.g., "PLAT")' },
        { status: 400 }
      );
    }

    console.log(`[Jira] Fetching data for project ${projectKey}...`);

    const issues = await fetchJiraData(projectKey);

    console.log(`[Jira] Fetched ${issues.length} issues`);

    for (const issue of issues) {
      db.run(
        `INSERT OR REPLACE INTO jira_issues
          (id, key, summary, description, status, priority, assignee, updated, url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          issue.id,
          issue.key,
          issue.summary,
          issue.description,
          issue.status,
          issue.priority,
          issue.assignee,
          issue.updated,
          issue.url,
        ]
      );
    }

    return NextResponse.json({
      success: true,
      projectKey,
      issues: issues.length,
    });

  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Jira] Monitoring error:', err.message);
    return NextResponse.json(
      { error: 'Failed to fetch Jira data', message: err.message },
      { status: 500 }
    );
  }
}

// ─── GET /api/monitor/jira — return stored issues ────────────────────────────

export async function GET() {
  try {
    const issues = db.all<{
      id: string; key: string; summary: string; description: string;
      status: string; priority: string; assignee: string;
      updated: string; url: string; created_at: string;
    }>(`SELECT * FROM jira_issues ORDER BY updated DESC LIMIT 100`);

    const domain = process.env.JIRA_DOMAIN || '';
    const email = process.env.JIRA_EMAIL || '';
    const token = process.env.JIRA_API_TOKEN || '';
    const isConfigured = !!(
      domain && !domain.includes('your-company') &&
      email && !email.includes('your-email') &&
      token && token.length > 8
    );

    return NextResponse.json({
      status: isConfigured ? 'connected' : 'not_configured',
      success: true,
      issues,
      count: issues.length,
    });

  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Jira] Query error:', err.message);
    return NextResponse.json(
      { error: 'Failed to query Jira issues', message: err.message },
      { status: 500 }
    );
  }
}
