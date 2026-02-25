/**
 * CIB Integration Test Script
 *
 * Tests: GitHub → Jira → Confluence → Slack → Discrepancy Detection → Q&A
 *
 * Run with: npx tsx scripts/test.ts
 * Or:       npm run test:integrations
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('✅ Loaded .env.local\n');
} else {
  console.log('⚠️  No .env.local found — using process.env\n');
}

// ─── Test runner ───────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
  details?: Record<string, unknown>;
  duration?: number;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  fn: () => Promise<{ message: string; details?: Record<string, unknown> }>
): Promise<void> {
  const start = Date.now();
  process.stdout.write(`  Running: ${name}... `);

  try {
    const result = await fn();
    const duration = Date.now() - start;
    console.log(`✅ ${result.message} (${duration}ms)`);
    results.push({
      name,
      status: 'pass',
      message: result.message,
      details: result.details,
      duration,
    });
  } catch (err) {
    const duration = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ ${msg} (${duration}ms)`);
    results.push({
      name,
      status: 'fail',
      message: msg,
      duration,
    });
  }
}

function skipTest(name: string, reason: string): void {
  console.log(`  Skipping: ${name} — ⏭️  ${reason}`);
  results.push({ name, status: 'skip', message: reason });
}

// ─── GitHub Tests ─────────────────────────────────────────────────────────────

async function testGitHub(): Promise<void> {
  console.log('\n📦 GITHUB INTEGRATION');

  const token = process.env.GITHUB_TOKEN;
  const isPlaceholder = !token || token.includes('placeholder') || token === 'test_placeholder_not_real' || token.length < 10;
  if (isPlaceholder) {
    skipTest('GitHub API connection', 'GITHUB_TOKEN is a placeholder — set a real token via Settings');
    skipTest('GitHub data fetch (vercel/next.js)', 'GITHUB_TOKEN not configured');
    return;
  }

  await runTest('GitHub API connection', async () => {
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.users.getAuthenticated();
    return {
      message: `Connected as @${data.login}`,
      details: { user: data.login, repos: data.public_repos },
    };
  });

  await runTest('GitHub data fetch (vercel/next.js)', async () => {
    const { fetchGitHubData } = await import('../src/lib/integrations/github');
    const data = await fetchGitHubData('vercel/next.js');
    return {
      message: `Fetched ${data.commits.length} commits, ${data.openPRs.length} PRs, ${data.techStack.length} tech items`,
      details: { commits: data.commits.length, prs: data.openPRs.length, tech: data.techStack.slice(0, 5) },
    };
  });
}

// ─── Jira Tests ────────────────────────────────────────────────────────────────

async function testJira(): Promise<void> {
  console.log('\n📋 JIRA INTEGRATION');

  const domain = process.env.JIRA_DOMAIN;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  const hasRealCredentials = domain && email && token &&
    !domain.includes('your-company') &&
    !email.includes('your-email') &&
    token.length > 8;

  if (!hasRealCredentials) {
    skipTest('Jira connection', 'Real JIRA credentials not configured — set via Settings page');
    skipTest('Jira data fetch', 'credentials not configured');
    return;
  }

  await runTest('Jira API connection', async () => {
    const axios = (await import('axios')).default;
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const { data } = await axios.get(`https://${cleanDomain}/rest/api/2/myself`, {
      auth: { username: email, password: token },
      timeout: 10000,
    });
    return {
      message: `Connected as ${data.displayName || data.emailAddress}`,
      details: { user: data.displayName, email: data.emailAddress },
    };
  });

  // Try to find a project
  await runTest('Jira project list', async () => {
    const axios = (await import('axios')).default;
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const { data } = await axios.get(`https://${cleanDomain}/rest/api/2/project`, {
      auth: { username: email, password: token },
      params: { maxResults: 5 },
      timeout: 10000,
    });
    const projects = (data as Array<{ key: string; name: string }>).slice(0, 5);
    return {
      message: `Found ${projects.length} project(s): ${projects.map((p) => p.key).join(', ')}`,
      details: { projects: projects.map((p) => ({ key: p.key, name: p.name })) },
    };
  });
}

// ─── Confluence Tests ──────────────────────────────────────────────────────────

async function testConfluence(): Promise<void> {
  console.log('\n📄 CONFLUENCE INTEGRATION');

  const domain = process.env.CONFLUENCE_DOMAIN;
  const email = process.env.CONFLUENCE_EMAIL;
  const token = process.env.CONFLUENCE_API_TOKEN;

  const hasRealCredentials = domain && email && token &&
    !domain.includes('your-company') &&
    !email.includes('your-email') &&
    token.length > 8;

  if (!hasRealCredentials) {
    skipTest('Confluence connection', 'Real Confluence credentials not configured — set via Settings page');
    skipTest('Confluence spaces', 'credentials not configured');
    return;
  }

  await runTest('Confluence API connection', async () => {
    const axios = (await import('axios')).default;
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const { data } = await axios.get(`https://${cleanDomain}/wiki/rest/api/user/current`, {
      auth: { username: email, password: token },
      timeout: 10000,
    });
    return {
      message: `Connected as ${data.displayName || data.username}`,
      details: { user: data.displayName, type: data.type },
    };
  });

  await runTest('Confluence space list', async () => {
    const axios = (await import('axios')).default;
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const { data } = await axios.get(`https://${cleanDomain}/wiki/rest/api/space`, {
      auth: { username: email, password: token },
      params: { limit: 5 },
      timeout: 10000,
    });
    const spaces = data.results || [];
    return {
      message: `Found ${spaces.length} space(s): ${spaces.map((s: { key: string }) => s.key).join(', ')}`,
      details: { spaces: spaces.map((s: { key: string; name: string }) => ({ key: s.key, name: s.name })) },
    };
  });
}

// ─── Slack Tests ───────────────────────────────────────────────────────────────

async function testSlack(): Promise<void> {
  console.log('\n💬 SLACK INTEGRATION');

  const token = process.env.SLACK_BOT_TOKEN;

  if (!token) {
    skipTest('Slack connection', 'SLACK_BOT_TOKEN not set');
    return;
  }

  await runTest('Slack auth test', async () => {
    const { testSlackConnection } = await import('../src/lib/integrations/slack');
    const result = await testSlackConnection(token);
    if (!result.success) throw new Error(result.error || 'Auth failed');
    return {
      message: `Connected to ${result.details?.team} as ${result.details?.user}`,
      details: result.details,
    };
  });
}

// ─── Teams Tests ──────────────────────────────────────────────────────────────

async function testTeams(): Promise<void> {
  console.log('\n🎯 MICROSOFT TEAMS INTEGRATION');

  const clientId = process.env.TEAMS_CLIENT_ID;
  const clientSecret = process.env.TEAMS_CLIENT_SECRET;
  const tenantId = process.env.TEAMS_TENANT_ID;

  const hasRealCredentials = clientId && clientSecret && tenantId &&
    !clientId.includes('your-') &&
    !tenantId.includes('your-') &&
    clientSecret.length > 8;

  if (!hasRealCredentials) {
    skipTest('Teams connection', 'Real Teams credentials not configured — set TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET, TEAMS_TENANT_ID via Settings');
    skipTest('Teams data fetch', 'credentials not configured');
    return;
  }

  await runTest('Teams API connection (Graph auth)', async () => {
    const { testTeamsConnection } = await import('../src/lib/integrations/teams');
    const result = await testTeamsConnection(clientId!, clientSecret!, tenantId!);
    if (!result.success) throw new Error(result.error || 'Auth failed');
    return {
      message: `Connected to ${result.details?.organization || 'Microsoft 365'}`,
      details: result.details,
    };
  });

  await runTest('Teams data fetch', async () => {
    const { fetchTeamsData } = await import('../src/lib/integrations/teams');
    const data = await fetchTeamsData();
    return {
      message: `Fetched ${data.messages.length} messages from ${data.teams.length} team(s)`,
      details: { teams: data.teams, messages: data.messages.length },
    };
  });
}

// ─── Database Tests ────────────────────────────────────────────────────────────

async function testDatabase(): Promise<void> {
  console.log('\n🗄️  DATABASE');

  await runTest('SQLite connection', async () => {
    const { db } = await import('../src/lib/db');
    const result = db.get<{ val: number }>('SELECT 1 as val');
    if (!result || result.val !== 1) throw new Error('Query returned unexpected result');
    return { message: 'SQLite WAL mode connected' };
  });

  await runTest('Table schema check', async () => {
    const { db } = await import('../src/lib/db');
    const tables = db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const names = tables.map((t) => t.name);
    const required = ['messages', 'discrepancies', 'github_events', 'github_snapshots', 'jira_issues', 'confluence_pages', 'slack_messages', 'teams_messages'];
    const missing = required.filter((t) => !names.includes(t));
    if (missing.length > 0) throw new Error(`Missing tables: ${missing.join(', ')}`);
    return { message: `All ${required.length} required tables exist`, details: { tables: names } };
  });
}

// ─── Discrepancy Detection Tests ──────────────────────────────────────────────

async function testDiscrepancyDetection(): Promise<void> {
  console.log('\n⚠️  DISCREPANCY DETECTION');

  await runTest('Run detection engine', async () => {
    const { detectDiscrepancies } = await import('../src/lib/discrepancy-detector');
    const result = await detectDiscrepancies();
    return {
      message: `Detected ${result.detected} discrepancies, saved ${result.saved} new`,
      details: { byType: result.byType },
    };
  });

  await runTest('Query stored discrepancies', async () => {
    const { getDiscrepancies } = await import('../src/lib/db');
    const all = getDiscrepancies();
    const unresolved = all.filter((d) => !d.resolved);
    return {
      message: `${all.length} total, ${unresolved.length} unresolved`,
      details: { total: all.length, unresolved: unresolved.length },
    };
  });
}

// ─── Answer Engine Test ────────────────────────────────────────────────────────

async function testAnswerEngine(): Promise<void> {
  console.log('\n🤖 ANSWER ENGINE');

  await runTest('Build DB context', async () => {
    const { buildDBContext } = await import('../src/lib/answer-engine');
    const ctx = buildDBContext('what is the current status of the project?');
    return {
      message: ctx.hasData
        ? `Context built: ${ctx.contextText.length} chars, ${ctx.sourceLabels.length} sources`
        : 'No DB data available yet (sync tools first)',
      details: { hasData: ctx.hasData, sources: ctx.sourceLabels },
    };
  });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey === 'your-key-here') {
    skipTest('Claude AI streaming', 'ANTHROPIC_API_KEY not configured');
    return;
  }

  await runTest('Claude API connection', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "CIB test OK" and nothing else.' }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return { message: `Claude responded: "${text.trim()}"` };
  });
}

// ─── API Endpoint Tests ────────────────────────────────────────────────────────

async function testAPIEndpoints(): Promise<void> {
  console.log('\n🌐 API ENDPOINTS (requires running dev server on :3000)');

  const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

  const endpoints = [
    { name: 'GET /api/monitor/github', url: `${BASE_URL}/api/monitor/github`, method: 'GET' },
    { name: 'GET /api/monitor/jira', url: `${BASE_URL}/api/monitor/jira`, method: 'GET' },
    { name: 'GET /api/monitor/confluence', url: `${BASE_URL}/api/monitor/confluence`, method: 'GET' },
    { name: 'GET /api/monitor/slack', url: `${BASE_URL}/api/monitor/slack`, method: 'GET' },
    { name: 'GET /api/monitor/teams', url: `${BASE_URL}/api/monitor/teams`, method: 'GET' },
    { name: 'GET /api/alerts', url: `${BASE_URL}/api/alerts`, method: 'GET' },
    { name: 'GET /api/discrepancies/detect', url: `${BASE_URL}/api/discrepancies/detect`, method: 'GET' },
    { name: 'GET /api/settings/credentials', url: `${BASE_URL}/api/settings/credentials`, method: 'GET' },
  ];

  for (const ep of endpoints) {
    await runTest(ep.name, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(ep.url, { method: ep.method, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { message: `HTTP ${res.status} OK` };
      } catch (e) {
        clearTimeout(timeout);
        const msg = (e as Error).message;
        if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('aborted')) {
          throw new Error('Dev server not running — start with: npm run dev');
        }
        throw e;
      }
    });
  }
}

// ─── Summary ───────────────────────────────────────────────────────────────────

function printSummary(): void {
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const total = results.length;

  console.log('\n' + '─'.repeat(60));
  console.log('TEST SUMMARY');
  console.log('─'.repeat(60));
  console.log(`  Total:   ${total}`);
  console.log(`  Passed:  ${passed} ✅`);
  console.log(`  Failed:  ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`  Skipped: ${skipped} ${skipped > 0 ? '⏭️' : ''}`);
  console.log('─'.repeat(60));

  if (failed > 0) {
    console.log('\nFailed tests:');
    results
      .filter((r) => r.status === 'fail')
      .forEach((r) => console.log(`  ❌ ${r.name}: ${r.message}`));
  }

  if (skipped > 0) {
    console.log('\nSkipped tests (configure credentials to enable):');
    results
      .filter((r) => r.status === 'skip')
      .forEach((r) => console.log(`  ⏭️  ${r.name}: ${r.message}`));
  }

  console.log('\n' + (failed > 0 ? '❌ TESTS FAILED' : '✅ ALL TESTS PASSED (or skipped)') + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('  CIB Integration Test Suite');
  console.log('  ' + new Date().toISOString());
  console.log('═'.repeat(60));

  await testDatabase();
  await testGitHub();
  await testJira();
  await testConfluence();
  await testSlack();
  await testTeams();
  await testDiscrepancyDetection();
  await testAnswerEngine();
  await testAPIEndpoints();

  printSummary();
}

main().catch((err) => {
  console.error('\n💥 Unhandled error:', err);
  process.exit(1);
});
