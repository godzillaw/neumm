import { NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';
import axios from 'axios';

type Integration = 'github' | 'jira' | 'confluence' | 'slack' | 'teams';

// ─── POST /api/settings/test-connection ──────────────────────────────────────
// Body: { integration: 'github' | 'jira' | 'confluence', ...credentials }

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      integration: Integration;
      // github / slack
      token?: string;
      // jira / confluence
      domain?: string;
      email?: string;
      apiToken?: string;
      // teams
      clientId?: string;
      clientSecret?: string;
      tenantId?: string;
    };

    const { integration } = body;

    switch (integration) {
      case 'github':
        return testGitHub(body.token);
      case 'jira':
        return testJira(body.domain, body.email, body.apiToken);
      case 'confluence':
        return testConfluence(body.domain, body.email, body.apiToken);
      case 'slack':
        return testSlack(body.token);
      case 'teams':
        return testTeams(body.clientId, body.clientSecret, body.tenantId);
      default:
        return NextResponse.json({ error: 'Unknown integration' }, { status: 400 });
    }
  } catch (err) {
    const e = err as Error;
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ─── GitHub test ──────────────────────────────────────────────────────────────

async function testGitHub(token?: string) {
  const tok = token || process.env.GITHUB_TOKEN;
  if (!tok) {
    return NextResponse.json({ success: false, error: 'No token provided' });
  }

  try {
    const octokit = new Octokit({ auth: tok });
    const { data } = await octokit.users.getAuthenticated();
    return NextResponse.json({
      success: true,
      details: {
        user: data.login,
        name: data.name || data.login,
        avatar: data.avatar_url,
        repos: data.public_repos + (data.total_private_repos ?? 0),
        plan: data.plan?.name || 'free',
      },
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status === 401) {
      return NextResponse.json({ success: false, error: 'Invalid token — check your GitHub Personal Access Token' });
    }
    return NextResponse.json({ success: false, error: e.message || 'GitHub connection failed' });
  }
}

// ─── Jira test ────────────────────────────────────────────────────────────────

async function testJira(domain?: string, email?: string, apiToken?: string) {
  const d = domain || process.env.JIRA_DOMAIN;
  const e = email || process.env.JIRA_EMAIL;
  const t = apiToken || process.env.JIRA_API_TOKEN;

  if (!d || !e || !t) {
    return NextResponse.json({ success: false, error: 'Domain, email, and API token are all required' });
  }

  const cleanDomain = d.replace(/^https?:\/\//, '').replace(/\/$/, '');

  try {
    const { data } = await axios.get(`https://${cleanDomain}/rest/api/2/myself`, {
      auth: { username: e, password: t },
      headers: { Accept: 'application/json' },
      timeout: 10000,
    });
    return NextResponse.json({
      success: true,
      details: {
        user: data.displayName || data.name,
        email: data.emailAddress,
        accountId: data.accountId,
        domain: cleanDomain,
      },
    });
  } catch (err) {
    const e2 = err as { response?: { status: number; data?: { errorMessages?: string[] } }; message?: string };
    if (e2.response?.status === 401) {
      return NextResponse.json({ success: false, error: 'Invalid email or API token' });
    }
    if (e2.response?.status === 403) {
      return NextResponse.json({ success: false, error: 'Access denied — check account permissions' });
    }
    const msg = e2.response?.data?.errorMessages?.[0] || e2.message || 'Jira connection failed';
    return NextResponse.json({ success: false, error: msg });
  }
}

// ─── Teams test ───────────────────────────────────────────────────────────────

async function testTeams(clientId?: string, clientSecret?: string, tenantId?: string) {
  const cId = clientId || process.env.TEAMS_CLIENT_ID;
  const cSecret = clientSecret || process.env.TEAMS_CLIENT_SECRET;
  const tId = tenantId || process.env.TEAMS_TENANT_ID;

  if (!cId || !cSecret || !tId) {
    return NextResponse.json({
      success: false,
      error: 'Client ID, Client Secret, and Tenant ID are all required',
    });
  }

  try {
    const { testTeamsConnection } = await import('@/lib/integrations/teams');
    const result = await testTeamsConnection(cId, cSecret, tId);
    return NextResponse.json(result);
  } catch (err) {
    const e = err as { message?: string };
    return NextResponse.json({ success: false, error: e.message || 'Teams connection failed' });
  }
}

// ─── Slack test ───────────────────────────────────────────────────────────────

async function testSlack(token?: string) {
  const tok = token || process.env.SLACK_BOT_TOKEN;
  if (!tok) {
    return NextResponse.json({ success: false, error: 'No Slack bot token provided' });
  }

  try {
    const { data } = await axios.get('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${tok}` },
      timeout: 8000,
    });

    if (!data.ok) {
      return NextResponse.json({ success: false, error: data.error || 'Authentication failed' });
    }

    return NextResponse.json({
      success: true,
      details: {
        user: data.user,
        team: data.team,
        url: data.url || '',
      },
    });
  } catch (err) {
    const e = err as { message?: string };
    return NextResponse.json({ success: false, error: e.message || 'Slack connection failed' });
  }
}

// ─── Confluence test ──────────────────────────────────────────────────────────

async function testConfluence(domain?: string, email?: string, apiToken?: string) {
  const d = domain || process.env.CONFLUENCE_DOMAIN;
  const e = email || process.env.CONFLUENCE_EMAIL;
  const t = apiToken || process.env.CONFLUENCE_API_TOKEN;

  if (!d || !e || !t) {
    return NextResponse.json({ success: false, error: 'Domain, email, and API token are all required' });
  }

  const cleanDomain = d.replace(/^https?:\/\//, '').replace(/\/$/, '');

  try {
    const { data } = await axios.get(`https://${cleanDomain}/wiki/rest/api/user/current`, {
      auth: { username: e, password: t },
      headers: { Accept: 'application/json' },
      timeout: 10000,
    });
    return NextResponse.json({
      success: true,
      details: {
        user: data.displayName || data.username,
        type: data.type,
        domain: cleanDomain,
      },
    });
  } catch (err) {
    const e2 = err as { response?: { status: number }; message?: string };
    if (e2.response?.status === 401) {
      return NextResponse.json({ success: false, error: 'Invalid email or API token' });
    }
    if (e2.response?.status === 403) {
      return NextResponse.json({ success: false, error: 'Access denied — check account permissions' });
    }
    return NextResponse.json({ success: false, error: e2.message || 'Confluence connection failed' });
  }
}
