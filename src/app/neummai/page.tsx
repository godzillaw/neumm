'use client';

import { useState, useCallback } from 'react';
import Sidebar from '@/components/SlackSidebar';
import ChatArea from '@/components/ChatArea';
import MessageInput from '@/components/MessageInput';
import AlertsPanel, { type AlertData } from '@/components/AlertsPanel';
import { type MessageData } from '@/components/Message';

// Use fixed ISO timestamps so server and client render identically (no hydration mismatch)
const INITIAL_ALERTS: AlertData[] = [
  {
    id: 'disc-1',
    type: 'status_drift',
    severity: 'high',
    title: 'Payment integration status conflict',
    documented: 'Payment integration complete per Confluence',
    actual: 'GitHub shows 3 open PRs for payment module',
    sources: ['Confluence: Payment Docs', 'GitHub: payment-module'],
    recommendation: 'Review open PRs and update documentation',
    resolved: false,
    detected_at: '2026-02-22T08:00:00.000Z',
  },
  {
    id: 'disc-2',
    type: 'timeline_drift',
    severity: 'medium',
    title: 'KDS launch date mismatch',
    documented: 'KDS scheduled for Nov 14 per Jira',
    actual: 'Slack message says KDS delayed to Nov 28',
    sources: ['Jira: KDS-123', 'Slack: #engineering'],
    recommendation: 'Align timeline across tools',
    resolved: false,
    detected_at: '2026-02-22T08:00:00.000Z',
  },
  {
    id: 'disc-3',
    type: 'ownership_drift',
    severity: 'low',
    title: 'API ownership unclear',
    documented: 'Backend team owns the payments API per Confluence',
    actual: 'Teams message assigns ownership to Platform team',
    sources: ['Confluence: API Ownership', 'Teams: #backend'],
    recommendation: 'Clarify and document ownership in Confluence',
    resolved: false,
    detected_at: '2026-02-22T08:00:00.000Z',
  },
];

// Welcome messages per channel — use fixed timestamps to avoid hydration mismatch
const WELCOME_MESSAGES: Record<string, MessageData[]> = {
  questions: [
    {
      id: 'welcome-questions-1',
      role: 'assistant',
      content:
        '👋 Welcome to **#questions**! Ask anything about PlateOS — sprint status, feature ownership, tech decisions, or cross-tool discrepancies.',
      timestamp: '2026-02-22T08:00:00.000Z',
    },
    {
      id: 'welcome-questions-2',
      role: 'assistant',
      content:
        'I monitor **GitHub, Jira, Confluence, Slack, and Teams** to give you a unified, up-to-date view of your project. Try asking: _"What is the current status of the payment integration?"_',
      timestamp: '2026-02-22T08:05:00.000Z',
    },
  ],
  updates: [
    {
      id: 'welcome-updates-1',
      role: 'assistant',
      content:
        '📋 Welcome to **#updates**! This channel surfaces the latest project changes detected across all your connected tools.',
      timestamp: '2026-02-22T08:00:00.000Z',
    },
    {
      id: 'welcome-updates-2',
      role: 'assistant',
      content:
        'Recent activity is automatically summarised here. You can ask things like: _"Summarise what changed in the last 48 hours"_ or _"What PRs were merged this week?"_',
      timestamp: '2026-02-22T08:05:00.000Z',
    },
  ],
  insights: [
    {
      id: 'welcome-insights-1',
      role: 'assistant',
      content:
        '💡 Welcome to **#insights**! Neumm surfaces patterns and trends it detects across your project knowledge base.',
      timestamp: '2026-02-22T08:00:00.000Z',
    },
    {
      id: 'welcome-insights-2',
      role: 'assistant',
      content:
        'Ask for deeper analysis: _"What are the biggest risks going into the next sprint?"_ or _"Are there recurring blockers across Jira tickets?"_',
      timestamp: '2026-02-22T08:05:00.000Z',
    },
  ],
};

function getWelcomeMessages(channel: string): MessageData[] {
  return WELCOME_MESSAGES[channel] ?? [
    {
      id: `welcome-${channel}-1`,
      role: 'assistant',
      content: `👋 Welcome to **#${channel}**! Ask anything about your project.`,
      timestamp: '2026-02-22T08:00:00.000Z',
    },
  ];
}

export default function Home() {
  const [activeChannel, setActiveChannel] = useState('questions');
  // Map from channel id → MessageData[]
  const [channelMessages, setChannelMessages] = useState<Map<string, MessageData[]>>(
    () => new Map([['questions', getWelcomeMessages('questions')]])
  );
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertData[]>(INITIAL_ALERTS);

  const activeAlertCount = alerts.filter((a) => !a.resolved).length;

  // Get messages for current channel, initializing with welcome messages if needed
  const currentMessages = channelMessages.get(activeChannel) ?? [];

  const handleChannelChange = useCallback(
    (channel: string) => {
      setActiveChannel(channel);
      setStreamingContent('');
      // Initialize welcome messages if this channel hasn't been visited
      setChannelMessages((prev) => {
        if (!prev.has(channel)) {
          const next = new Map(prev);
          next.set(channel, getWelcomeMessages(channel));
          return next;
        }
        return prev;
      });
    },
    []
  );

  const handleSend = useCallback(
    async (text: string) => {
      if (isLoading) return;

      const userMsg: MessageData = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      };

      // Add user message to channel
      setChannelMessages((prev) => {
        const next = new Map(prev);
        const existing = next.get(activeChannel) ?? [];
        next.set(activeChannel, [...existing, userMsg]);
        return next;
      });

      setIsLoading(true);
      setStreamingContent('');

      try {
        const response = await fetch('/api/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: text, persona: 'product-manager' }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';
        let finalSources: string[] = [];
        let finalConfidence: number | undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;

            try {
              const parsed = JSON.parse(raw);
              if (parsed.type === 'chunk' && parsed.text) {
                accumulated += parsed.text;
                setStreamingContent(accumulated);
              } else if (parsed.type === 'done') {
                finalSources = parsed.sources ?? [];
                finalConfidence = parsed.confidence;
              }
            } catch {
              // Ignore malformed JSON lines
            }
          }
        }

        // Process any remaining buffer content
        if (buffer.startsWith('data: ')) {
          try {
            const raw = buffer.slice(6).trim();
            if (raw && raw !== '[DONE]') {
              const parsed = JSON.parse(raw);
              if (parsed.type === 'done') {
                finalSources = parsed.sources ?? [];
                finalConfidence = parsed.confidence;
              }
            }
          } catch {
            // Ignore
          }
        }

        // Finalize the assistant message
        const assistantMsg: MessageData = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: accumulated || 'I was unable to generate a response. Please try again.',
          timestamp: new Date().toISOString(),
          sources: finalSources.length > 0 ? finalSources : undefined,
          confidence: finalConfidence,
        };

        setChannelMessages((prev) => {
          const next = new Map(prev);
          const existing = next.get(activeChannel) ?? [];
          next.set(activeChannel, [...existing, assistantMsg]);
          return next;
        });
      } catch (err) {
        console.error('Error sending message:', err);
        const errorMsg: MessageData = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
          timestamp: new Date().toISOString(),
        };
        setChannelMessages((prev) => {
          const next = new Map(prev);
          const existing = next.get(activeChannel) ?? [];
          next.set(activeChannel, [...existing, errorMsg]);
          return next;
        });
      } finally {
        setIsLoading(false);
        setStreamingContent('');
      }
    },
    [activeChannel, isLoading]
  );

  const handleResolveAlert = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, resolved: true } : a))
    );
  }, []);

  return (
    // Root: full-viewport horizontal flex row — inline styles guarantee no Tailwind purge issues
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
        position: 'relative',
      }}
    >
      {/* Left Sidebar — fixed 250px, never shrinks */}
      <Sidebar
        activeChannel={activeChannel}
        alertCount={activeAlertCount}
        onChannelChange={handleChannelChange}
        onAlertsClick={() => setAlertsPanelOpen(true)}
      />

      {/* Main content area — fills remaining width */}
      <div
        style={{
          flex: '1 1 0',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <ChatArea
          channel={activeChannel}
          messages={currentMessages}
          isLoading={isLoading}
          streamingContent={streamingContent}
        />
        <MessageInput
          onSend={handleSend}
          disabled={isLoading}
          channel={activeChannel}
        />
      </div>

      {/* Alerts Panel (slide out from right) */}
      <AlertsPanel
        isOpen={alertsPanelOpen}
        alerts={alerts}
        onClose={() => setAlertsPanelOpen(false)}
        onResolve={handleResolveAlert}
      />
    </div>
  );
}
