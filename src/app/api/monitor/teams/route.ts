import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ─── GET /api/monitor/teams — return stored messages ─────────────────────────

export async function GET() {
  try {
    const messages = db.all(
      'SELECT * FROM teams_messages ORDER BY timestamp DESC LIMIT 100'
    );

    const isConfigured = !!(
      process.env.TEAMS_CLIENT_ID &&
      process.env.TEAMS_CLIENT_SECRET &&
      process.env.TEAMS_TENANT_ID
    );

    return NextResponse.json({
      status: isConfigured ? 'connected' : 'not_configured',
      lastSync: new Date().toISOString(),
      count: messages.length,
      messages,
    });
  } catch (error) {
    console.error('[GET /api/monitor/teams]', error);
    return NextResponse.json({ error: 'Failed to fetch Teams messages' }, { status: 500 });
  }
}

// ─── POST /api/monitor/teams — fetch from Microsoft Graph and store ──────────

export async function POST() {
  const clientId = process.env.TEAMS_CLIENT_ID;
  const clientSecret = process.env.TEAMS_CLIENT_SECRET;
  const tenantId = process.env.TEAMS_TENANT_ID;

  if (!clientId || !clientSecret || !tenantId) {
    return NextResponse.json({
      success: false,
      status: 'not_configured',
      message: 'TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET, and TEAMS_TENANT_ID must all be set',
    });
  }

  try {
    const { fetchTeamsData } = await import('@/lib/integrations/teams');
    const data = await fetchTeamsData();

    let saved = 0;
    for (const msg of data.messages) {
      try {
        db.run(
          `INSERT OR REPLACE INTO teams_messages
           (id, team, channel, user, text, timestamp, url, is_decision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            msg.id,
            msg.teamName,
            msg.channelName,
            msg.user,
            msg.text,
            msg.timestamp,
            msg.url || null,
            msg.is_decision ? 1 : 0,
          ]
        );
        saved++;
      } catch {
        // Duplicate, skip
      }
    }

    return NextResponse.json({
      success: true,
      tenant: data.tenant,
      teams: data.teams,
      fetched: data.messages.length,
      saved,
      fetchedAt: data.fetchedAt,
    });
  } catch (error) {
    const msg = (error as Error).message;
    console.error('[POST /api/monitor/teams]', msg);
    return NextResponse.json({
      success: false,
      error: msg,
    }, { status: 500 });
  }
}
