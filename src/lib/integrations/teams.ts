/**
 * Microsoft Teams Integration
 *
 * Uses Microsoft Graph API with client credentials flow (app-only auth).
 * Required env vars:
 *   TEAMS_CLIENT_ID     — Azure AD app registration client ID
 *   TEAMS_CLIENT_SECRET — Azure AD app registration client secret
 *   TEAMS_TENANT_ID     — Azure AD tenant ID (your organisation's directory ID)
 *   TEAMS_TEAM_ID       — (optional) specific Team ID to monitor; if blank, monitors all joined teams
 *
 * App permissions needed in Azure AD (application, not delegated):
 *   ChannelMessage.Read.All
 *   Team.ReadBasic.All
 *   Channel.ReadBasic.All
 */

import axios from 'axios';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TeamsMessage {
  id: string;
  team: string;
  teamName: string;
  channel: string;
  channelName: string;
  user: string;
  text: string;
  timestamp: string;
  url?: string;
  is_decision: boolean;
}

export interface TeamsData {
  tenant: string;
  teams: string[];
  messages: TeamsMessage[];
  fetchedAt: string;
}

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

// ─── Token cache (in-process, cleared on restart) ─────────────────────────────

let _tokenCache: AccessTokenCache | null = null;

async function getAccessToken(
  tenantId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.token;
  }

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const { data } = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });

  _tokenCache = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return _tokenCache.token;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DECISION_SIGNALS = [
  'decided', 'decision', 'agreed', 'approved', 'confirmed',
  'we will', 'going with', 'choosing', 'selected', 'finalized',
  'sign off', 'sign-off', 'moving forward',
];

function isDecision(text: string): boolean {
  const lower = text.toLowerCase();
  return DECISION_SIGNALS.some((s) => lower.includes(s));
}

/** Strip HTML tags from Teams message body */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ─── Graph API helpers ────────────────────────────────────────────────────────

interface GraphTeam {
  id: string;
  displayName: string;
}

interface GraphChannel {
  id: string;
  displayName: string;
}

interface GraphMessage {
  id: string;
  createdDateTime: string;
  body: { contentType: string; content: string };
  from?: { user?: { displayName?: string; id?: string } };
  webUrl?: string;
  messageType: string;
}

async function listTeams(token: string, specificTeamId?: string): Promise<GraphTeam[]> {
  if (specificTeamId) {
    // Fetch just the one specified team
    const { data } = await axios.get(
      `https://graph.microsoft.com/v1.0/teams/${specificTeamId}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
    );
    return [{ id: data.id, displayName: data.displayName }];
  }

  // List all teams the app has access to
  const { data } = await axios.get(
    'https://graph.microsoft.com/v1.0/teams?$top=20',
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
  );
  return (data.value || []) as GraphTeam[];
}

async function listChannels(token: string, teamId: string): Promise<GraphChannel[]> {
  const { data } = await axios.get(
    `https://graph.microsoft.com/v1.0/teams/${teamId}/channels`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
  );
  return (data.value || []) as GraphChannel[];
}

async function listMessages(
  token: string,
  teamId: string,
  channelId: string
): Promise<GraphMessage[]> {
  // Fetch last 7 days of messages
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data } = await axios.get(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages?$top=50&$filter=createdDateTime ge ${since}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    return (data.value || []) as GraphMessage[];
  } catch (err) {
    const e = err as { response?: { status: number } };
    // 403 = channel not accessible, skip silently
    if (e.response?.status === 403 || e.response?.status === 404) return [];
    throw err;
  }
}

// ─── Main fetch function ──────────────────────────────────────────────────────

export async function fetchTeamsData(): Promise<TeamsData> {
  const clientId = process.env.TEAMS_CLIENT_ID;
  const clientSecret = process.env.TEAMS_CLIENT_SECRET;
  const tenantId = process.env.TEAMS_TENANT_ID;
  const specificTeamId = process.env.TEAMS_TEAM_ID || '';

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET, and TEAMS_TENANT_ID are required');
  }

  const token = await getAccessToken(tenantId, clientId, clientSecret);
  const teams = await listTeams(token, specificTeamId || undefined);

  if (teams.length === 0) {
    return {
      tenant: tenantId,
      teams: [],
      messages: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const allMessages: TeamsMessage[] = [];
  const teamNames: string[] = [];

  for (const team of teams.slice(0, 5)) {
    // Limit to first 5 teams
    teamNames.push(team.displayName);

    let channels: GraphChannel[];
    try {
      channels = await listChannels(token, team.id);
    } catch {
      console.warn(`[Teams] Cannot list channels for team ${team.displayName}`);
      continue;
    }

    for (const channel of channels.slice(0, 10)) {
      // Limit to 10 channels per team
      const messages = await listMessages(token, team.id, channel.id);

      for (const msg of messages) {
        if (msg.messageType !== 'message') continue;

        const raw = msg.body?.content || '';
        const text = msg.body?.contentType === 'html' ? stripHtml(raw) : raw;
        if (!text.trim()) continue;

        allMessages.push({
          id: `teams-${team.id}-${channel.id}-${msg.id}`,
          team: team.id,
          teamName: team.displayName,
          channel: channel.id,
          channelName: channel.displayName,
          user: msg.from?.user?.displayName || msg.from?.user?.id || 'Unknown',
          text,
          timestamp: msg.createdDateTime,
          url: msg.webUrl,
          is_decision: isDecision(text),
        });
      }
    }
  }

  return {
    tenant: tenantId,
    teams: teamNames,
    messages: allMessages,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Connection test ───────────────────────────────────────────────────────────

export async function testTeamsConnection(
  clientId: string,
  clientSecret: string,
  tenantId: string
): Promise<{ success: boolean; details?: Record<string, string>; error?: string }> {
  try {
    const token = await getAccessToken(tenantId, clientId, clientSecret);

    // Try fetching org info from Graph
    const { data } = await axios.get(
      'https://graph.microsoft.com/v1.0/organization?$select=displayName,id',
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      }
    );

    const org = data.value?.[0];
    return {
      success: true,
      details: {
        organization: org?.displayName || tenantId,
        tenantId,
        clientId,
      },
    };
  } catch (err) {
    const e = err as { response?: { data?: { error?: { message?: string; code?: string } }; status?: number }; message?: string };
    const msg =
      e.response?.data?.error?.message ||
      e.response?.data?.error?.code ||
      e.message ||
      'Connection failed';
    return { success: false, error: msg };
  }
}
