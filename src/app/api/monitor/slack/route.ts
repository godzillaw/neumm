import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ─── GET /api/monitor/slack — return stored messages ─────────────────────────

export async function GET() {
  try {
    const messages = db.all(
      'SELECT * FROM slack_messages ORDER BY timestamp DESC LIMIT 100'
    );
    return NextResponse.json({
      status: process.env.SLACK_BOT_TOKEN ? 'connected' : 'not_configured',
      lastSync: new Date().toISOString(),
      count: messages.length,
      messages,
    });
  } catch (error) {
    console.error('[GET /api/monitor/slack]', error);
    return NextResponse.json({ error: 'Failed to fetch Slack messages' }, { status: 500 });
  }
}

// ─── POST /api/monitor/slack — fetch and store messages ──────────────────────

export async function POST() {
  const token = process.env.SLACK_BOT_TOKEN;

  if (!token) {
    return NextResponse.json({
      success: false,
      status: 'not_configured',
      message: 'SLACK_BOT_TOKEN not set — add it in Settings to connect Slack',
    });
  }

  try {
    const { fetchSlackData } = await import('@/lib/integrations/slack');
    const data = await fetchSlackData();

    let saved = 0;
    for (const msg of data.messages) {
      try {
        db.run(
          `INSERT OR REPLACE INTO slack_messages
           (id, channel, user, text, timestamp, thread_ts, url, is_decision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            msg.id,
            msg.channelName,
            msg.user,
            msg.text,
            msg.timestamp,
            msg.thread_ts || null,
            msg.url || null,
            msg.is_decision ? 1 : 0,
          ]
        );
        saved++;
      } catch {
        // duplicate, skip
      }
    }

    return NextResponse.json({
      success: true,
      workspace: data.workspace,
      channels: data.channels,
      fetched: data.messages.length,
      saved,
      fetchedAt: data.fetchedAt,
    });
  } catch (error) {
    const msg = (error as Error).message;
    console.error('[POST /api/monitor/slack]', msg);
    return NextResponse.json({
      success: false,
      error: msg,
    }, { status: 500 });
  }
}
