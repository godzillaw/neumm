/**
 * Answer Engine — gathers context from all connected sources
 * and returns a rich context string + source labels for the AI answer route.
 */

import { db } from './db';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GithubSnapshot {
  repo: string;
  data: string;
  created_at: string;
}

interface JiraIssueRow {
  id: string;
  key: string;
  summary: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  assignee: string | null;
  updated: string | null;
}

interface ConfluencePageRow {
  id: string;
  title: string;
  content: string;
  space: string | null;
  updated: string | null;
  author: string | null;
}

interface SlackMessageRow {
  id: string;
  channel: string;
  user: string;
  text: string;
  timestamp: string;
  is_decision: number;
}

interface TeamsMessageRow {
  id: string;
  team: string;
  channel: string;
  user: string;
  text: string;
  timestamp: string;
  is_decision: number;
}

interface DiscrepancyRow {
  id: string;
  type: string;
  severity: string;
  title: string;
  documented: string;
  actual: string;
  sources: string;
  recommendation: string | null;
  detected_at: string;
}

// ─── Keyword extraction ───────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'what', 'is', 'the', 'a', 'an', 'how', 'why', 'when', 'where', 'who',
  'are', 'do', 'does', 'can', 'will', 'should', 'would', 'could', 'this',
  'that', 'these', 'those', 'with', 'from', 'about', 'into', 'have', 'has',
  'been', 'being', 'more', 'most', 'some', 'than', 'then', 'also', 'just',
  'only', 'very', 'much', 'tell', 'give', 'list', 'show', 'describe', 'get',
  'please', 'any', 'all', 'our', 'your', 'their', 'which', 'not', 'but',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

function textContainsKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

// ─── GitHub context ───────────────────────────────────────────────────────────

function buildGithubContext(question: string, keywords: string[]): string {
  const snapshot = db.get<GithubSnapshot>(
    'SELECT * FROM github_snapshots ORDER BY created_at DESC LIMIT 1'
  );
  if (!snapshot) return '';

  let data: {
    repo?: string;
    techStack?: string[];
    commits?: Array<{ message: string; author: string; date: string }>;
    openPRs?: Array<{ title: string; author: string; number: number }>;
    features?: string[];
    recentActivity?: string[];
  };
  try {
    data = JSON.parse(snapshot.data);
  } catch {
    return '';
  }

  const sections: string[] = [];
  const questionLower = question.toLowerCase();

  // Always include repo name
  if (data.repo) {
    sections.push(`GitHub Repository: ${data.repo} (synced ${snapshot.created_at.slice(0, 10)})`);
  }

  // Tech stack — always useful
  if (data.techStack && data.techStack.length > 0) {
    sections.push(`Tech Stack: ${data.techStack.slice(0, 20).join(', ')}`);
  }

  // Commits — filter by relevance
  if (data.commits && data.commits.length > 0) {
    const relevantCommits = keywords.length > 0
      ? data.commits.filter((c) => textContainsKeywords(c.message, keywords))
      : data.commits;
    const shown = relevantCommits.slice(0, 8);
    if (shown.length > 0) {
      sections.push(
        `Recent Commits (${shown.length} shown):\n` +
        shown.map((c) => `  - [${c.date?.slice(0, 10) || 'unknown'}] ${c.message.slice(0, 100)} — by ${c.author}`).join('\n')
      );
    }
  }

  // Open PRs — filter by relevance
  if (data.openPRs && data.openPRs.length > 0) {
    const relevantPRs = keywords.length > 0
      ? data.openPRs.filter((pr) => textContainsKeywords(pr.title, keywords))
      : data.openPRs;
    const shown = relevantPRs.slice(0, 6);
    if (shown.length > 0) {
      sections.push(
        `Open Pull Requests (${shown.length}):\n` +
        shown.map((pr) => `  - #${pr.number}: ${pr.title} (by ${pr.author})`).join('\n')
      );
    }
  }

  // Features extracted from README
  if (data.features && data.features.length > 0 && textContainsKeywords(questionLower, ['feature', 'what', 'capabilit', 'include'])) {
    sections.push(
      `Project Features:\n` +
      data.features.slice(0, 10).map((f) => `  - ${f}`).join('\n')
    );
  }

  if (sections.length === 0) return '';

  return `\n\nGITHUB DATA:\n${sections.join('\n\n')}`;
}

// ─── Jira context ─────────────────────────────────────────────────────────────

function buildJiraContext(keywords: string[]): string {
  const issues = db.all<JiraIssueRow>(
    'SELECT * FROM jira_issues ORDER BY updated DESC LIMIT 100'
  );
  if (issues.length === 0) return '';

  // Filter by relevance if we have keywords
  const relevant = keywords.length > 0
    ? issues.filter((i) => textContainsKeywords(i.summary + ' ' + (i.description || ''), keywords))
    : issues;

  if (relevant.length === 0) return '';

  const shown = relevant.slice(0, 15);

  const lines = shown.map((i) =>
    `  - ${i.key}: ${i.summary} [${i.status || 'Unknown'}] Priority: ${i.priority || 'None'} Assignee: ${i.assignee || 'Unassigned'}`
  );

  return `\n\nJIRA ISSUES (${shown.length} relevant):\n${lines.join('\n')}`;
}

// ─── Confluence context ────────────────────────────────────────────────────────

function buildConfluenceContext(keywords: string[]): string {
  const pages = db.all<ConfluencePageRow>(
    'SELECT * FROM confluence_pages ORDER BY updated DESC LIMIT 50'
  );
  if (pages.length === 0) return '';

  const relevant = keywords.length > 0
    ? pages.filter((p) => textContainsKeywords(p.title + ' ' + p.content, keywords))
    : pages;

  if (relevant.length === 0) return '';

  const shown = relevant.slice(0, 8);

  const sections = shown.map((p) => {
    const excerpt = p.content.length > 500
      ? p.content.slice(0, 500) + '…'
      : p.content;
    return `  Page: "${p.title}" (${p.space || 'unknown space'}, updated ${p.updated?.slice(0, 10) || 'unknown'})\n  ${excerpt}`;
  });

  return `\n\nCONFLUENCE DOCUMENTATION (${shown.length} relevant pages):\n${sections.join('\n\n')}`;
}

// ─── Slack context ────────────────────────────────────────────────────────────

function buildSlackContext(keywords: string[]): string {
  const messages = db.all<SlackMessageRow>(
    'SELECT * FROM slack_messages ORDER BY timestamp DESC LIMIT 200'
  );
  if (messages.length === 0) return '';

  // Filter by relevance + prioritize decisions
  const decisions = messages.filter((m) => m.is_decision === 1);
  const relevant = keywords.length > 0
    ? messages.filter((m) => textContainsKeywords(m.text, keywords))
    : messages.slice(0, 20);

  const combined = [
    ...decisions.filter((m) => relevant.some((r) => r.id === m.id)),
    ...relevant.filter((m) => !decisions.some((d) => d.id === m.id)),
  ].slice(0, 15);

  if (combined.length === 0) return '';

  const lines = combined.map((m) => {
    const prefix = m.is_decision ? '📌 DECISION' : '💬';
    return `  ${prefix} [${m.channel}] ${m.user}: ${m.text.slice(0, 200)}`;
  });

  return `\n\nSLACK MESSAGES (${combined.length} relevant):\n${lines.join('\n')}`;
}

// ─── Teams context ────────────────────────────────────────────────────────────

function buildTeamsContext(keywords: string[]): string {
  const messages = db.all<TeamsMessageRow>(
    'SELECT * FROM teams_messages ORDER BY timestamp DESC LIMIT 200'
  );
  if (messages.length === 0) return '';

  const decisions = messages.filter((m) => m.is_decision === 1);
  const relevant = keywords.length > 0
    ? messages.filter((m) => textContainsKeywords(m.text, keywords))
    : messages.slice(0, 20);

  const combined = [
    ...decisions.filter((m) => relevant.some((r) => r.id === m.id)),
    ...relevant.filter((m) => !decisions.some((d) => d.id === m.id)),
  ].slice(0, 15);

  if (combined.length === 0) return '';

  const lines = combined.map((m) => {
    const prefix = m.is_decision ? '📌 DECISION' : '💬';
    return `  ${prefix} [${m.team}/${m.channel}] ${m.user}: ${m.text.slice(0, 200)}`;
  });

  return `\n\nMICROSOFT TEAMS MESSAGES (${combined.length} relevant):\n${lines.join('\n')}`;
}

// ─── Discrepancy context ──────────────────────────────────────────────────────

function buildDiscrepancyContext(keywords: string[]): string {
  const discrepancies = db.all<DiscrepancyRow>(
    'SELECT * FROM discrepancies WHERE resolved = 0 ORDER BY detected_at DESC LIMIT 20'
  );
  if (discrepancies.length === 0) return '';

  const relevant = keywords.length > 0
    ? discrepancies.filter((d) =>
        textContainsKeywords(d.title + ' ' + d.documented + ' ' + d.actual, keywords)
      )
    : discrepancies;

  if (relevant.length === 0) return '';

  const lines = relevant.slice(0, 8).map((d) =>
    `  ⚠️ [${d.severity.toUpperCase()}] ${d.title}\n` +
    `     Documented: ${d.documented}\n` +
    `     Actual: ${d.actual}\n` +
    (d.recommendation ? `     Recommendation: ${d.recommendation}` : '')
  );

  return `\n\nDETECTED DISCREPANCIES (${relevant.length} unresolved):\n${lines.join('\n\n')}`;
}

// ─── Source labels ────────────────────────────────────────────────────────────

export function buildDBSourceLabels(): string[] {
  const labels: string[] = [];

  const snapshotCount = db.get<{ count: number }>('SELECT COUNT(*) as count FROM github_snapshots')?.count || 0;
  if (snapshotCount > 0) {
    const snap = db.get<{ repo: string; created_at: string }>('SELECT repo, created_at FROM github_snapshots ORDER BY created_at DESC LIMIT 1');
    if (snap) labels.push(`GitHub: ${snap.repo} (${snap.created_at.slice(0, 10)})`);
  }

  const jiraCount = db.get<{ count: number }>('SELECT COUNT(*) as count FROM jira_issues')?.count || 0;
  if (jiraCount > 0) labels.push(`Jira: ${jiraCount} issues`);

  const conflCount = db.get<{ count: number }>('SELECT COUNT(*) as count FROM confluence_pages')?.count || 0;
  if (conflCount > 0) labels.push(`Confluence: ${conflCount} pages`);

  const slackCount = db.get<{ count: number }>('SELECT COUNT(*) as count FROM slack_messages')?.count || 0;
  if (slackCount > 0) labels.push(`Slack: ${slackCount} messages`);

  const teamsCount = db.get<{ count: number }>('SELECT COUNT(*) as count FROM teams_messages')?.count || 0;
  if (teamsCount > 0) labels.push(`Teams: ${teamsCount} messages`);

  const discCount = db.get<{ count: number }>('SELECT COUNT(*) as count FROM discrepancies WHERE resolved = 0')?.count || 0;
  if (discCount > 0) labels.push(`${discCount} active discrepancies detected`);

  return labels;
}

// ─── Main context builder ─────────────────────────────────────────────────────

export interface DBContext {
  contextText: string;
  sourceLabels: string[];
  hasData: boolean;
}

export function buildDBContext(question: string): DBContext {
  const keywords = extractKeywords(question);

  const githubCtx = buildGithubContext(question, keywords);
  const jiraCtx = buildJiraContext(keywords);
  const confluenceCtx = buildConfluenceContext(keywords);
  const slackCtx = buildSlackContext(keywords);
  const teamsCtx = buildTeamsContext(keywords);
  const discrepancyCtx = buildDiscrepancyContext(keywords);

  const contextText = [githubCtx, jiraCtx, confluenceCtx, slackCtx, teamsCtx, discrepancyCtx]
    .filter(Boolean)
    .join('');

  const sourceLabels = buildDBSourceLabels();
  const hasData = contextText.length > 0;

  return { contextText, sourceLabels, hasData };
}
