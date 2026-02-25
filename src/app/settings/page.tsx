'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Github, Zap, RefreshCw, MessageSquare, Video } from 'lucide-react';
import IntegrationCard, { type ConnectionStatus } from '@/components/IntegrationCard';

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg: '#F0F4FF',
  navy: '#1B3A6B',
  blue: '#4A90D9',
  teal: '#38B2AC',
  muted: '#6B7A99',
  border: '#E2EAF4',
  card: '#FFFFFF',
};

// ─── Field definitions per integration ───────────────────────────────────────

const GITHUB_FIELDS = [
  {
    key: 'GITHUB_TOKEN',
    label: 'Personal Access Token',
    placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
    type: 'password' as const,
    helpText: 'Classic token with repo and read:org scopes. Fine-grained tokens also work.',
  },
];

const JIRA_FIELDS = [
  {
    key: 'JIRA_DOMAIN',
    label: 'Atlassian Domain',
    placeholder: 'your-company.atlassian.net',
    type: 'text' as const,
    helpText: 'Your Atlassian domain — no https://',
  },
  {
    key: 'JIRA_EMAIL',
    label: 'Account Email',
    placeholder: 'you@yourcompany.com',
    type: 'email' as const,
  },
  {
    key: 'JIRA_API_TOKEN',
    label: 'API Token',
    placeholder: 'ATATT3xFfGF0…',
    type: 'password' as const,
    helpText: 'Generate at id.atlassian.com/manage-profile/security/api-tokens',
  },
];

const SLACK_FIELDS = [
  {
    key: 'SLACK_BOT_TOKEN',
    label: 'Bot Token',
    placeholder: 'xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx',
    type: 'password' as const,
    helpText: 'Create a Slack app and install it to your workspace to get a bot token.',
  },
  {
    key: 'SLACK_CHANNELS',
    label: 'Channels to monitor (comma-separated)',
    placeholder: 'general,engineering,product',
    type: 'text' as const,
    helpText: 'Channel names without #. The bot must be invited to each channel.',
  },
];

const TEAMS_FIELDS = [
  {
    key: 'TEAMS_TENANT_ID',
    label: 'Tenant ID (Directory ID)',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    type: 'text' as const,
    helpText: 'Found in Azure Portal → Azure Active Directory → Overview → Tenant ID',
  },
  {
    key: 'TEAMS_CLIENT_ID',
    label: 'Application (Client) ID',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    type: 'text' as const,
    helpText: 'Found in Azure Portal → App registrations → your app → Application (client) ID',
  },
  {
    key: 'TEAMS_CLIENT_SECRET',
    label: 'Client Secret',
    placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    type: 'password' as const,
    helpText: 'Azure Portal → App registrations → Certificates & secrets → New client secret',
  },
  {
    key: 'TEAMS_TEAM_ID',
    label: 'Team ID to monitor (optional)',
    placeholder: 'Leave blank to monitor all accessible teams',
    type: 'text' as const,
    helpText: 'Specific Team ID to monitor. Leave blank to pull from all teams the app can access.',
  },
];

const CONFLUENCE_FIELDS = [
  {
    key: 'CONFLUENCE_DOMAIN',
    label: 'Atlassian Domain',
    placeholder: 'your-company.atlassian.net',
    type: 'text' as const,
    helpText: 'Usually the same as your Jira domain',
  },
  {
    key: 'CONFLUENCE_EMAIL',
    label: 'Account Email',
    placeholder: 'you@yourcompany.com',
    type: 'email' as const,
  },
  {
    key: 'CONFLUENCE_API_TOKEN',
    label: 'API Token',
    placeholder: 'ATATT3xFfGF0…',
    type: 'password' as const,
    helpText: 'Same token as Jira if using the same Atlassian account',
  },
];

// ─── State shape ──────────────────────────────────────────────────────────────

interface CredentialState {
  values: Record<string, string>;
  status: ConnectionStatus;
  details: Record<string, string> | null;
}

const EMPTY: CredentialState = { values: {}, status: 'idle', details: null };

// ─── Sync banner ──────────────────────────────────────────────────────────────

function SyncBanner({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  return (
    <div className="flex items-center justify-between px-6 py-3 rounded-xl mb-6"
      style={{ backgroundColor: `${C.blue}12`, border: `1px solid ${C.blue}33` }}>
      <div>
        <p className="text-sm font-semibold" style={{ color: C.navy }}>
          Sync latest data from connected tools
        </p>
        <p className="text-xs mt-0.5" style={{ color: C.muted }}>
          Pulls commits, PRs, Jira issues and Confluence pages into Neumm&apos;s knowledge base
        </p>
      </div>
      <button
        onClick={onSync}
        disabled={syncing}
        className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-opacity"
        style={{ backgroundColor: C.blue, color: '#FFFFFF', opacity: syncing ? 0.7 : 1 }}
      >
        <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
        {syncing ? 'Syncing…' : 'Sync Now'}
      </button>
    </div>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const [github, setGithub] = useState<CredentialState>(EMPTY);
  const [jira, setJira] = useState<CredentialState>(EMPTY);
  const [confluence, setConfluence] = useState<CredentialState>(EMPTY);
  const [slack, setSlack] = useState<CredentialState>(EMPTY);
  const [teams, setTeams] = useState<CredentialState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<string[]>([]);

  // ── Load current credential state from server ──
  useEffect(() => {
    fetch('/api/settings/credentials')
      .then((r) => r.json())
      .then((data) => {
        setGithub({
          values: { GITHUB_TOKEN: '' }, // never pre-fill token value for security
          status: data.github.connected ? 'connected' : 'idle',
          details: data.github.connected ? { masked: data.github.token } : null,
        });
        setJira({
          values: {
            JIRA_DOMAIN: data.jira.domain || '',
            JIRA_EMAIL: data.jira.email || '',
            JIRA_API_TOKEN: '',
          },
          status: data.jira.connected ? 'connected' : 'idle',
          details: data.jira.connected ? { domain: data.jira.domain, email: data.jira.email } : null,
        });
        setConfluence({
          values: {
            CONFLUENCE_DOMAIN: data.confluence.domain || '',
            CONFLUENCE_EMAIL: data.confluence.email || '',
            CONFLUENCE_API_TOKEN: '',
          },
          status: data.confluence.connected ? 'connected' : 'idle',
          details: data.confluence.connected ? { domain: data.confluence.domain, email: data.confluence.email } : null,
        });
        setSlack({
          values: {
            SLACK_BOT_TOKEN: '',
            SLACK_CHANNELS: data.slack?.channels || 'general,engineering,product',
          },
          status: data.slack?.connected ? 'connected' : 'idle',
          details: data.slack?.connected ? { workspace: data.slack.workspace || '' } : null,
        });
        setTeams({
          values: {
            TEAMS_TENANT_ID: data.teams?.tenantId || '',
            TEAMS_CLIENT_ID: data.teams?.clientId || '',
            TEAMS_CLIENT_SECRET: '',
            TEAMS_TEAM_ID: data.teams?.teamId || '',
          },
          status: data.teams?.connected ? 'connected' : 'idle',
          details: data.teams?.connected ? { organization: data.teams.clientId || '' } : null,
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // ── Save + test a credential set ──
  const handleSave = useCallback(async (
    integration: 'github' | 'jira' | 'confluence' | 'slack' | 'teams',
    values: Record<string, string>
  ) => {
    // 1. Save to .env.local
    await fetch('/api/settings/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    // 2. Test the live connection
    const testBody: Record<string, string> = { integration };
    if (integration === 'github') {
      testBody.token = values.GITHUB_TOKEN;
    } else if (integration === 'jira') {
      testBody.domain = values.JIRA_DOMAIN;
      testBody.email = values.JIRA_EMAIL;
      testBody.apiToken = values.JIRA_API_TOKEN;
    } else if (integration === 'confluence') {
      testBody.domain = values.CONFLUENCE_DOMAIN;
      testBody.email = values.CONFLUENCE_EMAIL;
      testBody.apiToken = values.CONFLUENCE_API_TOKEN;
    } else if (integration === 'slack') {
      testBody.token = values.SLACK_BOT_TOKEN;
    } else if (integration === 'teams') {
      testBody.clientId = values.TEAMS_CLIENT_ID;
      testBody.clientSecret = values.TEAMS_CLIENT_SECRET;
      testBody.tenantId = values.TEAMS_TENANT_ID;
    }

    const res = await fetch('/api/settings/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testBody),
    });
    const result = await res.json() as { success: boolean; error?: string; details?: Record<string, string> };
    return result;
  }, []);

  // ── Sync all connected integrations ──
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncLog([]);

    const log = (msg: string) => setSyncLog((prev) => [...prev, msg]);

    try {
      if (github.status === 'connected') {
        log('📦 Syncing GitHub…');
        // Use the repo from env or a sensible default — user can customise
        const repo = process.env.NEXT_PUBLIC_GITHUB_REPO || '';
        if (repo) {
          const r = await fetch('/api/monitor/github', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo }),
          }).then((x) => x.json()) as { success?: boolean; commits?: number; prs?: number; error?: string };
          log(r.success
            ? `✅ GitHub: ${r.commits} commits, ${r.prs} PRs synced`
            : `❌ GitHub: ${r.error}`);
        } else {
          log('⚠️ GitHub: set NEXT_PUBLIC_GITHUB_REPO=owner/repo to auto-sync');
        }
      }

      if (jira.status === 'connected') {
        log('📋 Syncing Jira…');
        const projectKey = process.env.NEXT_PUBLIC_JIRA_PROJECT || '';
        if (projectKey) {
          const r = await fetch('/api/monitor/jira', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectKey }),
          }).then((x) => x.json()) as { success?: boolean; issues?: number; error?: string };
          log(r.success
            ? `✅ Jira: ${r.issues} issues synced`
            : `❌ Jira: ${r.error}`);
        } else {
          log('⚠️ Jira: set NEXT_PUBLIC_JIRA_PROJECT=YOUR_KEY to auto-sync');
        }
      }

      if (confluence.status === 'connected') {
        log('📄 Syncing Confluence…');
        const spaceKey = process.env.NEXT_PUBLIC_CONFLUENCE_SPACE || '';
        if (spaceKey) {
          const r = await fetch('/api/monitor/confluence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spaceKey }),
          }).then((x) => x.json()) as { success?: boolean; pages?: number; error?: string };
          log(r.success
            ? `✅ Confluence: ${r.pages} pages synced`
            : `❌ Confluence: ${r.error}`);
        } else {
          log('⚠️ Confluence: set NEXT_PUBLIC_CONFLUENCE_SPACE=YOUR_SPACE to auto-sync');
        }
      }
    } finally {
      setSyncing(false);
    }
  }, [github.status, jira.status, confluence.status]);

  const anyConnected = [github, jira, confluence, slack, teams].some((s) => s.status === 'connected');

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: C.bg }}>
        <div className="text-sm" style={{ color: C.muted }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: C.bg }}>
      {/* Top nav */}
      <div style={{ backgroundColor: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 24px' }}>
          <div className="flex items-center gap-4 py-4">
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2 text-sm transition-colors"
              style={{ color: C.muted }}
              onMouseEnter={(e) => (e.currentTarget.style.color = C.navy)}
              onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Neumm
            </button>
            <div style={{ width: 1, height: 20, backgroundColor: C.border }} />
            <div className="flex items-center gap-2">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ borderRadius: 5, flexShrink: 0 }}>
                <defs>
                  <linearGradient id="ng-set" x1="0" y1="0" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#4DD9C0"/>
                    <stop offset="100%" stopColor="#3A7BD5"/>
                  </linearGradient>
                </defs>
                <rect width="22" height="22" rx="5.5" fill="url(#ng-set)"/>
                <path d="M5 17.5V4.5h2.8l7 9.8V4.5H17.5v13h-2.8L7.8 7.7V17.5H5z" fill="white"/>
              </svg>
              <span className="font-bold text-base" style={{ color: C.navy }}>Neumm Settings</span>
            </div>
            <div className="ml-auto">
              <span className="text-xs px-2 py-1 rounded-full"
                style={{ backgroundColor: `${C.navy}12`, color: C.navy }}>
                Integrations
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px' }}>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2" style={{ color: C.navy }}>
            Connect your tools
          </h1>
          <p className="text-sm" style={{ color: C.muted }}>
            Neumm pulls data from GitHub, Jira, and Confluence to give you a unified, AI-powered view
            of your project. Enter your credentials below — they&apos;re stored locally in <code
              style={{ backgroundColor: '#F3F4F6', padding: '1px 4px', borderRadius: 4, fontSize: 11 }}
            >.env.local</code> and never sent to any third party.
          </p>
        </div>

        {/* Sync banner — only show when at least one is connected */}
        {anyConnected && <SyncBanner onSync={handleSync} syncing={syncing} />}

        {/* Sync log */}
        {syncLog.length > 0 && (
          <div className="mb-6 p-4 rounded-xl text-xs space-y-1"
            style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, fontFamily: 'monospace' }}>
            {syncLog.map((line, i) => (
              <div key={i} style={{ color: C.navy }}>{line}</div>
            ))}
          </div>
        )}

        {/* GitHub */}
        <div className="mb-2">
          <div className="flex items-center gap-2 mb-3">
            <Github className="w-4 h-4" style={{ color: C.muted }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.muted }}>
              GitHub
            </span>
          </div>
          <IntegrationCard
            id="github"
            title="GitHub"
            description="Monitor commits, pull requests, and extract your tech stack"
            icon={<Github className="w-5 h-5" />}
            accentColor="#24292F"
            fields={GITHUB_FIELDS}
            initialValues={github.values}
            initialStatus={github.status}
            connectedDetails={github.details}
            helpUrl="https://github.com/settings/tokens/new?description=Neumm+Integration&scopes=repo,read:org"
            onSave={async (values) => {
              const r = await handleSave('github', values);
              if (r.success) {
                setGithub((prev) => ({ ...prev, status: 'connected', details: r.details ?? null }));
              }
              return r;
            }}
          />
        </div>

        {/* Atlassian section */}
        <div className="mt-6 mb-2">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4" style={{ color: C.muted }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.muted }}>
              Atlassian
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `${C.blue}12`, color: C.blue }}>
              Same API token for both
            </span>
          </div>

          <IntegrationCard
            id="jira"
            title="Jira"
            description="Sync issues, sprints, priorities and status changes"
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53zM6.77 6.8a4.362 4.362 0 0 0 4.35 4.35h1.78v1.71a4.362 4.362 0 0 0 4.35 4.35V7.64a.84.84 0 0 0-.84-.84H6.77zM2 11.6c0 2.4 1.97 4.35 4.35 4.35h1.78v1.71C8.13 20.06 10.1 22 12.5 22v-9.16a.84.84 0 0 0-.84-.84H2v-.4z"/>
              </svg>
            }
            accentColor="#0052CC"
            fields={JIRA_FIELDS}
            initialValues={jira.values}
            initialStatus={jira.status}
            connectedDetails={jira.details}
            helpUrl="https://id.atlassian.com/manage-profile/security/api-tokens"
            onSave={async (values) => {
              const r = await handleSave('jira', values);
              if (r.success) {
                setJira((prev) => ({ ...prev, status: 'connected', details: r.details ?? null }));
                // Auto-copy domain+email to Confluence if not yet set
                setConfluence((prev) => ({
                  ...prev,
                  values: {
                    CONFLUENCE_DOMAIN: prev.values.CONFLUENCE_DOMAIN || values.JIRA_DOMAIN || '',
                    CONFLUENCE_EMAIL: prev.values.CONFLUENCE_EMAIL || values.JIRA_EMAIL || '',
                    CONFLUENCE_API_TOKEN: prev.values.CONFLUENCE_API_TOKEN || '',
                  },
                }));
              }
              return r;
            }}
          />

          <IntegrationCard
            id="confluence"
            title="Confluence"
            description="Index documentation, decisions, and knowledge base pages"
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <path d="M2.012 14.737c-.196.32-.42.689-.608.954a.596.596 0 0 0 .206.842l3.329 2.04a.596.596 0 0 0 .833-.188c.167-.253.37-.576.59-.923C7.97 15.555 9.258 13.7 12 13.7c2.742 0 4.027 1.853 5.638 3.762.218.347.42.67.589.923a.596.596 0 0 0 .833.187l3.329-2.04a.596.596 0 0 0 .206-.842c-.189-.265-.413-.635-.608-.954C20.265 12.286 18.05 9.3 12 9.3c-6.05 0-8.265 2.986-9.988 5.437zM21.988 9.263c.196-.32.42-.689.608-.954a.596.596 0 0 0-.206-.842l-3.329-2.04a.596.596 0 0 0-.833.188c-.167.253-.37.576-.59.923C16.03 8.445 14.742 10.3 12 10.3c-2.742 0-4.027-1.853-5.638-3.762a24.39 24.39 0 0 0-.589-.923.596.596 0 0 0-.833-.187l-3.329 2.04a.596.596 0 0 0-.206.842c.189.265.413.635.608.954C3.735 11.714 5.95 14.7 12 14.7c6.05 0 8.265-2.986 9.988-5.437z"/>
              </svg>
            }
            accentColor="#0065FF"
            fields={CONFLUENCE_FIELDS}
            initialValues={confluence.values}
            initialStatus={confluence.status}
            connectedDetails={confluence.details}
            helpUrl="https://id.atlassian.com/manage-profile/security/api-tokens"
            onSave={async (values) => {
              const r = await handleSave('confluence', values);
              if (r.success) {
                setConfluence((prev) => ({ ...prev, status: 'connected', details: r.details ?? null }));
              }
              return r;
            }}
          />
        </div>

        {/* Slack section */}
        <div className="mt-6 mb-2">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4" style={{ color: C.muted }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.muted }}>
              Slack
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `${C.muted}12`, color: C.muted }}>
              Optional
            </span>
          </div>
          <IntegrationCard
            id="github"
            title="Slack"
            description="Monitor channel messages for decisions, blockers, and timeline mentions"
            icon={<MessageSquare className="w-5 h-5" />}
            accentColor="#4A154B"
            fields={SLACK_FIELDS}
            initialValues={slack.values}
            initialStatus={slack.status}
            connectedDetails={slack.details}
            helpUrl="https://api.slack.com/authentication/basics"
            onSave={async (values) => {
              await fetch('/api/settings/credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(values),
              });
              const r = await fetch('/api/settings/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ integration: 'slack', token: values.SLACK_BOT_TOKEN }),
              }).then((x) => x.json()) as { success: boolean; error?: string; details?: Record<string, string> };
              if (r.success) {
                setSlack((prev) => ({ ...prev, status: 'connected', details: r.details ?? null }));
              }
              return r;
            }}
          />
        </div>

        {/* Microsoft Teams section */}
        <div className="mt-6 mb-2">
          <div className="flex items-center gap-2 mb-3">
            <Video className="w-4 h-4" style={{ color: C.muted }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.muted }}>
              Microsoft Teams
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `${C.muted}12`, color: C.muted }}>
              Optional
            </span>
          </div>
          <IntegrationCard
            id="teams"
            title="Microsoft Teams"
            description="Monitor team channel messages for decisions, blockers, and timeline mentions"
            icon={<Video className="w-5 h-5" />}
            accentColor="#6264A7"
            fields={TEAMS_FIELDS}
            initialValues={teams.values}
            initialStatus={teams.status}
            connectedDetails={teams.details}
            helpUrl="https://learn.microsoft.com/en-us/graph/auth-v2-service"
            onSave={async (values) => {
              await fetch('/api/settings/credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(values),
              });
              const r = await fetch('/api/settings/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  integration: 'teams',
                  clientId: values.TEAMS_CLIENT_ID,
                  clientSecret: values.TEAMS_CLIENT_SECRET,
                  tenantId: values.TEAMS_TENANT_ID,
                }),
              }).then((x) => x.json()) as { success: boolean; error?: string; details?: Record<string, string> };
              if (r.success) {
                setTeams((prev) => ({ ...prev, status: 'connected', details: r.details ?? null }));
              }
              return r;
            }}
          />
          <p className="text-xs mt-3 px-1" style={{ color: C.muted }}>
            <strong>Setup:</strong> Register an app in{' '}
            <a href="https://portal.azure.com" target="_blank" rel="noreferrer"
              style={{ color: C.blue, textDecoration: 'underline' }}>Azure Portal</a>
            , grant <code style={{ fontSize: 11 }}>ChannelMessage.Read.All</code>,{' '}
            <code style={{ fontSize: 11 }}>Team.ReadBasic.All</code>, and{' '}
            <code style={{ fontSize: 11 }}>Channel.ReadBasic.All</code> application permissions,
            then grant admin consent.
          </p>
        </div>

        {/* Footer note */}
        <p className="text-xs text-center mt-8" style={{ color: C.muted }}>
          Credentials are stored in <code style={{ fontFamily: 'monospace' }}>.env.local</code> on your
          machine. Neumm never transmits your tokens to external servers.
        </p>
      </div>
    </div>
  );
}
