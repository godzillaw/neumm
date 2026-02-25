import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ENV_PATH = join(process.cwd(), '.env.local');

// Keys we allow reading/writing via this API (never expose AI keys)
const ALLOWED_KEYS = new Set([
  'GITHUB_TOKEN',
  'JIRA_DOMAIN',
  'JIRA_EMAIL',
  'JIRA_API_TOKEN',
  'CONFLUENCE_DOMAIN',
  'CONFLUENCE_EMAIL',
  'CONFLUENCE_API_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_CHANNELS',
  'TEAMS_CLIENT_ID',
  'TEAMS_CLIENT_SECRET',
  'TEAMS_TENANT_ID',
  'TEAMS_TEAM_ID',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const lines = readFileSync(ENV_PATH, 'utf-8').split('\n');
  const env: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    env[key] = val;
  }
  return env;
}

function writeEnv(updates: Record<string, string>): void {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';
  const lines = existing.split('\n');
  const updatedKeys = new Set<string>();

  // Update existing lines in-place
  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return line;
    const key = trimmed.slice(0, idx).trim();
    if (key in updates && ALLOWED_KEYS.has(key)) {
      updatedKeys.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  // Append any keys that didn't exist yet
  for (const [key, val] of Object.entries(updates)) {
    if (!updatedKeys.has(key) && ALLOWED_KEYS.has(key)) {
      newLines.push(`${key}=${val}`);
    }
  }

  writeFileSync(ENV_PATH, newLines.join('\n'), 'utf-8');
}

function maskSecret(val: string): string {
  if (!val || val.length < 8) return val ? '••••••••' : '';
  return val.slice(0, 4) + '•'.repeat(Math.min(val.length - 8, 12)) + val.slice(-4);
}

// ─── GET /api/settings/credentials — return masked current values ─────────────

export async function GET() {
  const env = readEnv();

  return NextResponse.json({
    github: {
      token: maskSecret(env.GITHUB_TOKEN || ''),
      connected: !!(env.GITHUB_TOKEN && env.GITHUB_TOKEN.length > 8),
    },
    jira: {
      domain: env.JIRA_DOMAIN || '',
      email: env.JIRA_EMAIL || '',
      token: maskSecret(env.JIRA_API_TOKEN || ''),
      connected: !!(env.JIRA_DOMAIN && env.JIRA_EMAIL && env.JIRA_API_TOKEN &&
        !env.JIRA_DOMAIN.includes('your-company') &&
        env.JIRA_API_TOKEN.length > 8),
    },
    confluence: {
      domain: env.CONFLUENCE_DOMAIN || '',
      email: env.CONFLUENCE_EMAIL || '',
      token: maskSecret(env.CONFLUENCE_API_TOKEN || ''),
      connected: !!(env.CONFLUENCE_DOMAIN && env.CONFLUENCE_EMAIL && env.CONFLUENCE_API_TOKEN &&
        !env.CONFLUENCE_DOMAIN.includes('your-company') &&
        env.CONFLUENCE_API_TOKEN.length > 8),
    },
    slack: {
      channels: env.SLACK_CHANNELS || '',
      token: maskSecret(env.SLACK_BOT_TOKEN || ''),
      connected: !!(env.SLACK_BOT_TOKEN && env.SLACK_BOT_TOKEN.startsWith('xoxb-')),
    },
    teams: {
      clientId: env.TEAMS_CLIENT_ID || '',
      tenantId: env.TEAMS_TENANT_ID || '',
      teamId: env.TEAMS_TEAM_ID || '',
      secret: maskSecret(env.TEAMS_CLIENT_SECRET || ''),
      connected: !!(
        env.TEAMS_CLIENT_ID && env.TEAMS_CLIENT_SECRET && env.TEAMS_TENANT_ID &&
        !env.TEAMS_CLIENT_ID.includes('your-') &&
        env.TEAMS_CLIENT_SECRET.length > 8
      ),
    },
  });
}

// ─── POST /api/settings/credentials — save new credentials ───────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, string>;

    const updates: Record<string, string> = {};
    for (const [key, val] of Object.entries(body)) {
      if (ALLOWED_KEYS.has(key) && typeof val === 'string') {
        updates[key] = val;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid keys provided' }, { status: 400 });
    }

    writeEnv(updates);

    // Update process.env so the running process picks up changes without restart
    for (const [key, val] of Object.entries(updates)) {
      process.env[key] = val;
    }

    return NextResponse.json({ success: true, updated: Object.keys(updates) });
  } catch (err) {
    const e = err as Error;
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
