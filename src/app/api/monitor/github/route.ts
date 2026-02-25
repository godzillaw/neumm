import { NextResponse } from 'next/server';
import { fetchGitHubData, type GitHubCommit, type GitHubPR } from '@/lib/integrations/github';
import { db } from '@/lib/db';

// ─── POST /api/monitor/github — fetch & store GitHub data ────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json() as { repo?: string };
    const { repo } = body;

    if (!repo) {
      return NextResponse.json(
        { error: 'Repository name required (format: owner/repo)' },
        { status: 400 }
      );
    }

    console.log(`[GitHub] Fetching data for ${repo}...`);

    const data = await fetchGitHubData(repo);

    console.log(`[GitHub] Fetched ${data.commits.length} commits and ${data.prs.length} PRs`);

    storeGitHubData({ ...data, repo });

    return NextResponse.json({
      success: true,
      repo,
      commits: data.commits.length,
      prs: data.prs.length,
      techStack: data.techStack.length,
      intelligence: {
        features: data.extractedIntelligence.features.length,
        decisions: data.extractedIntelligence.decisions.length,
        performanceMentions: data.extractedIntelligence.performanceMentions.length,
      },
    });

  } catch (error: unknown) {
    const err = error as Error;
    console.error('[GitHub] Monitoring error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch GitHub data', message: err.message },
      { status: 500 }
    );
  }
}

// ─── GET /api/monitor/github — return stored events ──────────────────────────

export async function GET() {
  try {
    const events = db.all<{
      id: string; type: string; title: string; description: string;
      author: string; date: string; url: string; technologies: string; created_at: string;
    }>(`SELECT * FROM github_events ORDER BY date DESC LIMIT 100`);

    const token = process.env.GITHUB_TOKEN || '';
    const isConfigured = !!(
      token &&
      !token.includes('placeholder') &&
      !token.includes('your-') &&
      token.length > 10
    );

    return NextResponse.json({
      status: isConfigured ? 'connected' : 'not_configured',
      success: true,
      events,
      count: events.length,
    });

  } catch (error: unknown) {
    const err = error as Error;
    console.error('[GitHub] Query error:', err);
    return NextResponse.json(
      { error: 'Failed to query GitHub events', message: err.message },
      { status: 500 }
    );
  }
}

// ─── Store helper ─────────────────────────────────────────────────────────────

interface StorableData {
  repo: string;
  commits: GitHubCommit[];
  prs: GitHubPR[];
  techStack: string[];
  [key: string]: unknown;
}

function storeGitHubData(data: StorableData) {
  // Store commits
  for (const commit of data.commits) {
    db.run(
      `INSERT OR REPLACE INTO github_events
        (id, type, title, description, author, date, url, technologies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `commit_${commit.sha}`,
        'commit',
        commit.message.split('\n')[0],
        commit.message,
        commit.author,
        commit.date,
        commit.url,
        JSON.stringify(data.techStack),
      ]
    );
  }

  // Store PRs
  for (const pr of data.prs) {
    db.run(
      `INSERT OR REPLACE INTO github_events
        (id, type, title, description, author, date, url, technologies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pr.id,
        'pr',
        pr.title,
        pr.description,
        pr.author,
        pr.merged_at || new Date().toISOString(),
        pr.url,
        JSON.stringify(data.techStack),
      ]
    );
  }

  // Store full snapshot for AI context
  db.run(
    `INSERT INTO github_snapshots (repo, data) VALUES (?, ?)`,
    [data.repo, JSON.stringify(data)]
  );

  console.log(
    `[GitHub] Stored ${data.commits.length} commits + ${data.prs.length} PRs for ${data.repo}`
  );
}
