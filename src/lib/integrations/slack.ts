/**
 * Slack Integration
 *
 * Uses SLACK_BOT_TOKEN from env to fetch recent messages from configured channels.
 * Falls back gracefully if credentials are missing.
 */

import axios from 'axios';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SlackMessage {
  id: string;
  channel: string;
  channelName: string;
  user: string;
  text: string;
  timestamp: string;
  thread_ts?: string;
  url?: string;
  is_decision: boolean;
}

export interface SlackData {
  workspace: string;
  channels: string[];
  messages: SlackMessage[];
  fetchedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DECISION_SIGNALS = [
  'decided', 'decision', 'agreed', 'approved', 'confirmed',
  'we will', 'going with', 'choosing', 'selected', 'finalized',
];

function isDecision(text: string): boolean {
  const lower = text.toLowerCase();
  return DECISION_SIGNALS.some((s) => lower.includes(s));
}

function slackTsToDate(ts: string): string {
  const unix = parseFloat(ts);
  return new Date(unix * 1000).toISOString();
}

// ─── Main fetch function ──────────────────────────────────────────────────────

export async function fetchSlackData(channelNames?: string[]): Promise<SlackData> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }

  const headers = { Authorization: `Bearer ${token}` };
  const channels = channelNames || (process.env.SLACK_CHANNELS || 'general,engineering,product').split(',').map((c) => c.trim());

  // 1. Get list of channels to find IDs
  const channelsRes = await axios.get('https://slack.com/api/conversations.list', {
    headers,
    params: { types: 'public_channel,private_channel', limit: 200 },
    timeout: 10000,
  });

  if (!channelsRes.data.ok) {
    throw new Error(`Slack API error: ${channelsRes.data.error}`);
  }

  // Get workspace info
  let workspaceName = 'Slack Workspace';
  try {
    const teamRes = await axios.get('https://slack.com/api/team.info', { headers, timeout: 5000 });
    if (teamRes.data.ok) workspaceName = teamRes.data.team.name;
  } catch {
    // non-critical
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allChannels: any[] = channelsRes.data.channels || [];
  const channelMap = new Map<string, string>(); // name -> id
  for (const ch of allChannels) {
    channelMap.set(ch.name, ch.id);
    channelMap.set(`#${ch.name}`, ch.id);
  }

  // Collect messages from each channel
  const allMessages: SlackMessage[] = [];
  const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);

  for (const chName of channels) {
    const cleanName = chName.replace(/^#/, '');
    const channelId = channelMap.get(cleanName) || channelMap.get(`#${cleanName}`);
    if (!channelId) {
      console.warn(`[Slack] Channel "${cleanName}" not found`);
      continue;
    }

    try {
      const historyRes = await axios.get('https://slack.com/api/conversations.history', {
        headers,
        params: {
          channel: channelId,
          oldest: sevenDaysAgo,
          limit: 50,
        },
        timeout: 10000,
      });

      if (!historyRes.data.ok) {
        console.warn(`[Slack] Could not fetch #${cleanName}: ${historyRes.data.error}`);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages: any[] = historyRes.data.messages || [];

      for (const msg of messages) {
        if (!msg.text || msg.subtype === 'bot_message') continue;
        // Resolve user display name
        let userName = msg.user || 'Unknown';
        try {
          const userRes = await axios.get('https://slack.com/api/users.info', {
            headers,
            params: { user: msg.user },
            timeout: 5000,
          });
          if (userRes.data.ok) {
            userName = userRes.data.user.real_name || userRes.data.user.name || userName;
          }
        } catch {
          // Use ID as fallback
        }

        allMessages.push({
          id: `slack-${channelId}-${msg.ts}`,
          channel: channelId,
          channelName: cleanName,
          user: userName,
          text: msg.text,
          timestamp: slackTsToDate(msg.ts),
          thread_ts: msg.thread_ts,
          is_decision: isDecision(msg.text),
        });
      }
    } catch (err) {
      console.warn(`[Slack] Error fetching #${cleanName}:`, (err as Error).message);
    }
  }

  return {
    workspace: workspaceName,
    channels,
    messages: allMessages,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Connection test ───────────────────────────────────────────────────────────

export async function testSlackConnection(token: string): Promise<{
  success: boolean;
  details?: Record<string, string>;
  error?: string;
}> {
  try {
    const res = await axios.get('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000,
    });

    if (!res.data.ok) {
      return { success: false, error: res.data.error || 'Authentication failed' };
    }

    return {
      success: true,
      details: {
        user: res.data.user,
        team: res.data.team,
        url: res.data.url,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
