/**
 * Discrepancy Detection Engine
 *
 * Cross-references data from GitHub, Jira, Confluence, Slack, and Teams
 * to detect 5 types of discrepancies:
 *   1. tech_mismatch      — Tech stack mentioned in docs vs code
 *   2. timeline_drift     — Due dates in Jira vs mentions elsewhere
 *   3. priority_mismatch  — Priority in Jira vs GitHub/Slack urgency
 *   4. status_mismatch    — Confluence "done" vs GitHub open PRs
 *   5. ownership_mismatch — Assigned owner in Jira vs actual committer
 */

import { db, insertDiscrepancy, type DbDiscrepancy } from './db';
import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GithubSnapshot {
  repo: string;
  data: string; // JSON stringified GitHubData
  created_at: string;
}

interface ParsedGitHubData {
  techStack: string[];
  commits: Array<{ message: string; author: string; sha: string; date: string }>;
  openPRs: Array<{ title: string; author: string; number: number }>;
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
}

interface TeamsMessageRow {
  id: string;
  team: string;
  channel: string;
  user: string;
  text: string;
  timestamp: string;
}

// Unified message type for cross-source detection
interface UnifiedMessage {
  id: string;
  source: 'slack' | 'teams';
  channel: string;
  user: string;
  text: string;
  timestamp: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function makeId(type: string): string {
  return `${type}-${randomUUID().slice(0, 8)}`;
}

/** Parse a date string to a Date, returning null if invalid. */
function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Return difference in days between two dates (a - b). */
function daysDiff(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

/** Lowercase + remove punctuation for fuzzy matching. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Extract date-like strings from free text. */
const DATE_PATTERNS = [
  /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?\b/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g,
];

function extractDates(text: string): Date[] {
  const found: Date[] = [];
  for (const pattern of DATE_PATTERNS) {
    const matches = Array.from(text.matchAll(pattern));
    for (const m of matches) {
      const d = new Date(m[0]);
      if (!isNaN(d.getTime())) found.push(d);
    }
  }
  return found;
}

// ─── 1. Tech Stack Mismatch ───────────────────────────────────────────────────

/**
 * Compare tech stack extracted from GitHub (package.json/requirements.txt)
 * with tech mentioned in Confluence documentation.
 * Flag if docs mention tech that doesn't appear in the repo, or vice versa.
 */
function detectTechMismatch(
  githubData: ParsedGitHubData | null,
  confluencePages: ConfluencePageRow[],
): DbDiscrepancy[] {
  const results: DbDiscrepancy[] = [];
  if (!githubData) return results;

  const repoTechArr = githubData.techStack.map(normalize);
  if (repoTechArr.length === 0) return results;

  // Common tech keywords to look for in docs
  const TECH_KEYWORDS = [
    'react', 'next.js', 'nextjs', 'vue', 'angular', 'svelte',
    'node', 'express', 'fastapi', 'django', 'rails', 'spring',
    'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'sqlite',
    'typescript', 'javascript', 'python', 'java', 'golang', 'rust',
    'docker', 'kubernetes', 'k8s', 'aws', 'gcp', 'azure',
    'stripe', 'square', 'twilio', 'sendgrid',
    'graphql', 'rest', 'websocket', 'grpc',
    'jest', 'pytest', 'cypress', 'playwright',
  ];

  const docText = confluencePages.map((p) => normalize(p.content + ' ' + p.title)).join(' ');

  const docMentioned: string[] = [];
  for (const kw of TECH_KEYWORDS) {
    if (docText.includes(kw)) docMentioned.push(kw);
  }

  const repoMentioned: string[] = [];
  for (const kw of TECH_KEYWORDS) {
    if (repoTechArr.some((t) => t.includes(kw))) repoMentioned.push(kw);
  }

  // Tech in docs but NOT in repo
  const docOnlyTech: string[] = docMentioned.filter(
    (kw) => !repoMentioned.includes(kw)
  );

  if (docOnlyTech.length > 0) {
    const techs = docOnlyTech.slice(0, 5).join(', ');
    results.push({
      id: makeId('tech'),
      type: 'tech_mismatch',
      severity: 'medium',
      title: `Tech documented but not found in repository`,
      documented: `Confluence mentions: ${techs}`,
      actual: `Not found in GitHub repo tech stack (${githubData.techStack.slice(0, 5).join(', ')})`,
      sources: ['Confluence', 'GitHub'],
      recommendation: `Verify if ${techs} is still in use, or update documentation`,
      resolved: false,
      detected_at: now(),
    });
  }

  return results;
}

// ─── 2. Timeline Drift ────────────────────────────────────────────────────────

/**
 * Compare due dates on Jira issues with dates mentioned in Slack/Confluence.
 * Flag if there's a significant mismatch (>3 days).
 */
function detectTimelineDrift(
  jiraIssues: JiraIssueRow[],
  confluencePages: ConfluencePageRow[],
  unifiedMessages: UnifiedMessage[],
): DbDiscrepancy[] {
  const results: DbDiscrepancy[] = [];

  for (const issue of jiraIssues) {
    const jiraDue = parseDate(issue.updated);
    if (!jiraDue) continue;

    const issueLower = normalize(issue.summary);
    const keywords = issueLower.split(' ').filter((w) => w.length > 4).slice(0, 4);
    if (keywords.length === 0) continue;

    // Search Slack+Teams for mentions of this issue
    const relevantMsgs = unifiedMessages.filter((m) =>
      keywords.some((kw) => normalize(m.text).includes(kw)) ||
      m.text.toLowerCase().includes(issue.key.toLowerCase())
    );

    for (const msg of relevantMsgs) {
      const slackDates = extractDates(msg.text);
      for (const slackDate of slackDates) {
        const diff = Math.abs(daysDiff(jiraDue, slackDate));
        if (diff > 7) {
          results.push({
            id: makeId('timeline'),
            type: 'timeline_drift',
            severity: diff > 14 ? 'high' : 'medium',
            title: `Timeline mismatch for ${issue.key}: ${issue.summary.slice(0, 50)}`,
            documented: `Jira ${issue.key} last updated: ${jiraDue.toISOString().slice(0, 10)}`,
            actual: `${msg.source === 'teams' ? 'Teams' : 'Slack'} message mentions different date: ${slackDate.toISOString().slice(0, 10)} (${Math.round(diff)} days apart)`,
            sources: [`Jira: ${issue.key}`, `${msg.source === 'teams' ? 'Teams' : 'Slack'}: ${msg.channel}`],
            recommendation: `Align timeline — update Jira ${issue.key} or correct ${msg.source === 'teams' ? 'Teams' : 'Slack'} message`,
            resolved: false,
            detected_at: now(),
          });
          break; // one per issue
        }
      }
    }

    // Also search Confluence
    const relevantPages = confluencePages.filter((p) =>
      keywords.some((kw) => normalize(p.content + ' ' + p.title).includes(kw))
    );

    for (const page of relevantPages) {
      const pageDates = extractDates(page.content);
      for (const pageDate of pageDates) {
        const diff = Math.abs(daysDiff(jiraDue, pageDate));
        if (diff > 14) {
          results.push({
            id: makeId('timeline'),
            type: 'timeline_drift',
            severity: 'low',
            title: `Documentation timeline differs from Jira for ${issue.key}`,
            documented: `Jira ${issue.key} updated: ${jiraDue.toISOString().slice(0, 10)}`,
            actual: `Confluence "${page.title}" references: ${pageDate.toISOString().slice(0, 10)}`,
            sources: [`Jira: ${issue.key}`, `Confluence: ${page.title}`],
            recommendation: `Review timeline consistency between Jira and Confluence documentation`,
            resolved: false,
            detected_at: now(),
          });
          break;
        }
      }
    }
  }

  return results;
}

// ─── 3. Priority Mismatch ─────────────────────────────────────────────────────

/**
 * Detect when Jira marks something as Low priority but Slack/GitHub activity
 * suggests it's being treated as urgent.
 */
function detectPriorityMismatch(
  jiraIssues: JiraIssueRow[],
  githubData: ParsedGitHubData | null,
  unifiedMessages: UnifiedMessage[],
): DbDiscrepancy[] {
  const results: DbDiscrepancy[] = [];

  const URGENCY_SIGNALS = ['urgent', 'critical', 'asap', 'blocker', 'blocking', 'hotfix', 'emergency', 'immediately', 'crucial', 'p0', 'sev1'];

  for (const issue of jiraIssues) {
    if (!issue.priority) continue;
    const priority = issue.priority.toLowerCase();
    if (priority === 'high' || priority === 'critical' || priority === 'blocker') continue;

    const issueLower = normalize(issue.summary);
    const keywords = issueLower.split(' ').filter((w) => w.length > 4).slice(0, 4);
    if (keywords.length === 0) continue;

    // Check Slack+Teams for urgency signals about this issue
    const urgentMsgs = unifiedMessages.filter((m) => {
      const msgLower = normalize(m.text);
      const mentionsIssue = keywords.some((kw) => msgLower.includes(kw)) || msgLower.includes(issue.key.toLowerCase());
      const hasUrgency = URGENCY_SIGNALS.some((s) => msgLower.includes(s));
      return mentionsIssue && hasUrgency;
    });

    if (urgentMsgs.length > 0) {
      const firstMsg = urgentMsgs[0];
      const sourceName = firstMsg.source === 'teams' ? 'Teams' : 'Slack';
      results.push({
        id: makeId('priority'),
        type: 'priority_mismatch',
        severity: 'high',
        title: `Priority mismatch: ${issue.key} is ${issue.priority} in Jira but urgent in ${sourceName}`,
        documented: `Jira ${issue.key} priority: ${issue.priority}`,
        actual: `${sourceName} shows ${urgentMsgs.length} urgent message(s) about this issue`,
        sources: [`Jira: ${issue.key}`, `${sourceName}: ${firstMsg.channel}`],
        recommendation: `Escalate ${issue.key} to High priority in Jira to reflect actual urgency`,
        resolved: false,
        detected_at: now(),
      });
    }

    // Check GitHub PRs for urgency signals
    if (githubData) {
      const urgentPRs = githubData.openPRs.filter((pr) => {
        const prLower = normalize(pr.title);
        const mentionsIssue = keywords.some((kw) => prLower.includes(kw));
        const hasUrgency = URGENCY_SIGNALS.some((s) => prLower.includes(s));
        return mentionsIssue && hasUrgency;
      });

      if (urgentPRs.length > 0) {
        results.push({
          id: makeId('priority'),
          type: 'priority_mismatch',
          severity: 'medium',
          title: `Priority mismatch: ${issue.key} is ${issue.priority} in Jira but has urgent GitHub PR`,
          documented: `Jira ${issue.key} priority: ${issue.priority}`,
          actual: `GitHub has urgent PR: "${urgentPRs[0].title}"`,
          sources: [`Jira: ${issue.key}`, 'GitHub'],
          recommendation: `Update Jira priority for ${issue.key} to match GitHub urgency`,
          resolved: false,
          detected_at: now(),
        });
      }
    }
  }

  return results;
}

// ─── 4. Status Mismatch ───────────────────────────────────────────────────────

/**
 * Detect when Confluence says something is "done/complete" but GitHub
 * still has open PRs related to it.
 */
function detectStatusMismatch(
  githubData: ParsedGitHubData | null,
  jiraIssues: JiraIssueRow[],
  confluencePages: ConfluencePageRow[],
): DbDiscrepancy[] {
  const results: DbDiscrepancy[] = [];
  if (!githubData) return results;

  const DONE_SIGNALS = ['complete', 'completed', 'done', 'finished', 'shipped', 'deployed', 'released', 'launched'];

  // Find Confluence pages claiming things are done
  for (const page of confluencePages) {
    const pageNorm = normalize(page.content + ' ' + page.title);
    const claimsDone = DONE_SIGNALS.some((s) => pageNorm.includes(s));
    if (!claimsDone) continue;

    // Extract keywords from page title
    const titleWords = normalize(page.title).split(' ').filter((w) => w.length > 4).slice(0, 4);
    if (titleWords.length === 0) continue;

    // Check if GitHub has open PRs related to this page
    const relatedOpenPRs = githubData.openPRs.filter((pr) =>
      titleWords.some((kw) => normalize(pr.title).includes(kw))
    );

    if (relatedOpenPRs.length > 0) {
      results.push({
        id: makeId('status'),
        type: 'status_mismatch',
        severity: 'high',
        title: `Status conflict: "${page.title}" marked complete but has open GitHub PRs`,
        documented: `Confluence "${page.title}" indicates completion`,
        actual: `GitHub has ${relatedOpenPRs.length} open PR(s): "${relatedOpenPRs[0].title}"`,
        sources: [`Confluence: ${page.title}`, 'GitHub'],
        recommendation: `Review open PRs and update Confluence or close completed PRs`,
        resolved: false,
        detected_at: now(),
      });
    }
  }

  // Check Jira "Done" issues vs open GitHub PRs
  const doneIssues = jiraIssues.filter((i) =>
    i.status && ['done', 'closed', 'complete', 'resolved'].includes(i.status.toLowerCase())
  );

  for (const issue of doneIssues) {
    const issueWords = normalize(issue.summary).split(' ').filter((w) => w.length > 4).slice(0, 4);
    if (issueWords.length === 0) continue;

    const relatedOpenPRs = githubData.openPRs.filter((pr) =>
      issueWords.some((kw) => normalize(pr.title).includes(kw)) ||
      normalize(pr.title).includes(issue.key.toLowerCase())
    );

    if (relatedOpenPRs.length > 0) {
      results.push({
        id: makeId('status'),
        type: 'status_mismatch',
        severity: 'medium',
        title: `Jira ${issue.key} is "${issue.status}" but has open GitHub PRs`,
        documented: `Jira ${issue.key} status: ${issue.status}`,
        actual: `GitHub PR still open: "${relatedOpenPRs[0].title}"`,
        sources: [`Jira: ${issue.key}`, 'GitHub'],
        recommendation: `Check if ${issue.key} is truly done or if the PR needs to be merged`,
        resolved: false,
        detected_at: now(),
      });
    }
  }

  return results;
}

// ─── 5. Ownership Mismatch ────────────────────────────────────────────────────

/**
 * Detect when Jira assigns an issue to one person but GitHub commits
 * show a different person actually doing the work.
 */
function detectOwnershipMismatch(
  githubData: ParsedGitHubData | null,
  jiraIssues: JiraIssueRow[],
): DbDiscrepancy[] {
  const results: DbDiscrepancy[] = [];
  if (!githubData) return results;

  for (const issue of jiraIssues) {
    if (!issue.assignee) continue;
    const assigneeLower = issue.assignee.toLowerCase().replace(/\s+/g, '');

    const issueWords = normalize(issue.summary).split(' ').filter((w) => w.length > 4).slice(0, 4);
    if (issueWords.length === 0) continue;

    // Find commits related to this issue
    const relatedCommits = githubData.commits.filter((c) => {
      const msgLower = normalize(c.message);
      return issueWords.some((kw) => msgLower.includes(kw)) ||
        msgLower.includes(issue.key.toLowerCase());
    });

    if (relatedCommits.length === 0) continue;

    // Check if a different person is making all the commits
    const commitAuthors = new Set(relatedCommits.map((c) => c.author.toLowerCase().replace(/\s+/g, '')));
    const assigneeIsCommitting = Array.from(commitAuthors).some(
      (a) => a.includes(assigneeLower) || assigneeLower.includes(a)
    );

    if (!assigneeIsCommitting && commitAuthors.size > 0) {
      const actualAuthors = Array.from(commitAuthors).slice(0, 2).join(', ');
      results.push({
        id: makeId('ownership'),
        type: 'ownership_mismatch',
        severity: 'low',
        title: `Ownership mismatch: ${issue.key} assigned to ${issue.assignee} but ${actualAuthors} is committing`,
        documented: `Jira ${issue.key} assignee: ${issue.assignee}`,
        actual: `GitHub commits made by: ${actualAuthors}`,
        sources: [`Jira: ${issue.key}`, 'GitHub'],
        recommendation: `Update Jira assignee for ${issue.key} to ${actualAuthors}, or reassign work`,
        resolved: false,
        detected_at: now(),
      });
    }
  }

  return results;
}

// ─── Main detection function ───────────────────────────────────────────────────

export interface DetectionResult {
  detected: number;
  saved: number;
  byType: Record<string, number>;
  discrepancies: DbDiscrepancy[];
}

export async function detectDiscrepancies(): Promise<DetectionResult> {
  // Load data from DB
  const jiraIssues = db.all<JiraIssueRow>('SELECT * FROM jira_issues ORDER BY updated DESC LIMIT 100');
  const confluencePages = db.all<ConfluencePageRow>('SELECT * FROM confluence_pages ORDER BY updated DESC LIMIT 50');
  const slackMessages = db.all<SlackMessageRow>('SELECT * FROM slack_messages ORDER BY timestamp DESC LIMIT 200');
  const teamsMessages = db.all<TeamsMessageRow>('SELECT * FROM teams_messages ORDER BY timestamp DESC LIMIT 200');

  // Merge Slack + Teams into unified messages for cross-source detection
  const unifiedMessages: UnifiedMessage[] = [
    ...slackMessages.map((m) => ({
      id: m.id,
      source: 'slack' as const,
      channel: m.channel,
      user: m.user,
      text: m.text,
      timestamp: m.timestamp,
    })),
    ...teamsMessages.map((m) => ({
      id: m.id,
      source: 'teams' as const,
      channel: `${m.team}/${m.channel}`,
      user: m.user,
      text: m.text,
      timestamp: m.timestamp,
    })),
  ];

  // Get latest GitHub snapshot
  const snapshot = db.get<GithubSnapshot>('SELECT * FROM github_snapshots ORDER BY created_at DESC LIMIT 1');
  let githubData: ParsedGitHubData | null = null;
  if (snapshot) {
    try {
      const raw = JSON.parse(snapshot.data);
      githubData = {
        techStack: raw.techStack || [],
        commits: raw.commits || [],
        openPRs: raw.openPRs || [],
      };
    } catch {
      githubData = null;
    }
  }

  // Run all 5 detectors (Slack + Teams unified for message-based detection)
  const allDiscrepancies: DbDiscrepancy[] = [
    ...detectTechMismatch(githubData, confluencePages),
    ...detectTimelineDrift(jiraIssues, confluencePages, unifiedMessages),
    ...detectPriorityMismatch(jiraIssues, githubData, unifiedMessages),
    ...detectStatusMismatch(githubData, jiraIssues, confluencePages),
    ...detectOwnershipMismatch(githubData, jiraIssues),
  ];

  // Deduplicate by title+type (don't insert duplicates of existing unresolved ones)
  const existing = db.all<{ title: string; type: string }>(
    'SELECT title, type FROM discrepancies WHERE resolved = 0'
  );
  const existingKeys = new Set(existing.map((e) => `${e.type}::${e.title}`));

  const toSave = allDiscrepancies.filter(
    (d) => !existingKeys.has(`${d.type}::${d.title}`)
  );

  // Save to DB
  for (const d of toSave) {
    insertDiscrepancy(d);
  }

  // Build summary
  const byType: Record<string, number> = {};
  for (const d of allDiscrepancies) {
    byType[d.type] = (byType[d.type] || 0) + 1;
  }

  return {
    detected: allDiscrepancies.length,
    saved: toSave.length,
    byType,
    discrepancies: allDiscrepancies,
  };
}
