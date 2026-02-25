import axios from 'axios';

// ─── Jira API client ──────────────────────────────────────────────────────────

function getJiraApi() {
  const domain = process.env.JIRA_DOMAIN;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!domain || !email || !token) {
    throw new Error('Missing Jira credentials: JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN required');
  }

  return axios.create({
    baseURL: `https://${domain}/rest/api/2`,
    auth: { username: email, password: token },
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
  assignee: string;
  labels: string[];
  updated: string;
  created: string;
  url: string;
}

export interface JiraProjectInfo {
  key: string;
  name: string;
  description: string;
}

// ─── Fetch issues (last 7 days) ───────────────────────────────────────────────

export async function fetchJiraData(projectKey: string): Promise<JiraIssue[]> {
  const jiraApi = getJiraApi();

  const jql = `project = ${projectKey} AND updated >= -7d ORDER BY updated DESC`;

  const { data } = await jiraApi.get('/search', {
    params: {
      jql,
      maxResults: 100,
      fields: 'summary,description,status,priority,assignee,labels,updated,created',
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.issues as any[]).map((issue) => ({
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary,
    description: stripJiraMarkdown(issue.fields.description || ''),
    status: issue.fields.status?.name || 'Unknown',
    priority: issue.fields.priority?.name || 'None',
    assignee: issue.fields.assignee?.displayName || 'Unassigned',
    labels: issue.fields.labels || [],
    updated: issue.fields.updated,
    created: issue.fields.created,
    url: `https://${process.env.JIRA_DOMAIN}/browse/${issue.key}`,
  }));
}

// ─── Get project metadata ─────────────────────────────────────────────────────

export async function getProjectInfo(projectKey: string): Promise<JiraProjectInfo | null> {
  try {
    const jiraApi = getJiraApi();
    const { data } = await jiraApi.get(`/project/${projectKey}`);
    return {
      key: data.key,
      name: data.name,
      description: data.description || '',
    };
  } catch (err) {
    console.error('[Jira] Failed to get project info:', err);
    return null;
  }
}

// ─── Strip Jira ADF/wiki markup to plain text ─────────────────────────────────

function stripJiraMarkdown(text: string): string {
  if (!text) return '';
  // Handle Atlassian Document Format (JSON) if present
  try {
    const doc = JSON.parse(text);
    if (doc?.type === 'doc') {
      return extractAdfText(doc);
    }
  } catch {
    // Not JSON — treat as wiki markup
  }
  // Strip wiki markup: {code}, {panel}, *bold*, _italic_, etc.
  return text
    .replace(/\{code[^}]*\}[\s\S]*?\{code\}/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/[*_~^+]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000); // cap at 2k chars for DB storage
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAdfText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (Array.isArray(node.content)) {
    return node.content.map(extractAdfText).join(' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}
