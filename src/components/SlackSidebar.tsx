'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Waves, Bell, CheckCircle, Circle, HelpCircle, Settings, ChevronDown, Loader, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export interface SidebarProps {
  activeChannel: string;
  alertCount: number;
  onChannelChange: (channel: string) => void;
  onAlertsClick: () => void;
}

const STREAMS = [
  { id: 'questions', label: 'questions' },
  { id: 'updates',   label: 'updates' },
  { id: 'insights',  label: 'insights' },
];

const MONITORING_TOOLS = [
  { id: 'github',     label: 'GitHub',     endpoint: '/api/monitor/github' },
  { id: 'jira',       label: 'Jira',       endpoint: '/api/monitor/jira' },
  { id: 'confluence', label: 'Confluence', endpoint: '/api/monitor/confluence' },
  { id: 'slack',      label: 'Slack',      endpoint: '/api/monitor/slack' },
  { id: 'teams',      label: 'Teams',      endpoint: '/api/monitor/teams' },
];

const C = {
  sidebarBg:     '#1B3A6B',
  sidebarBorder: '#142D56',
  sidebarHover:  '#24487F',
  activeItem:    'rgba(255,255,255,0.15)',
  mutedText:     '#8AAED4',
  white:         '#FFFFFF',
  alertRed:      '#E05555',
  teal:          '#38B2AC',
};

type ConnectionStatus = 'checking' | 'connected' | 'disconnected';

function useToolStatus(endpoint: string): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setStatus('disconnected');
          return;
        }
        const data = await res.json() as { status?: string };
        if (!cancelled) {
          setStatus(data.status === 'connected' ? 'connected' : 'disconnected');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('disconnected');
      });
    return () => { cancelled = true; };
  }, [endpoint]);

  return status;
}

function ToolRow({ tool }: { tool: typeof MONITORING_TOOLS[number] }) {
  const status = useToolStatus(tool.endpoint);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: '6px 16px',
      }}
    >
      {status === 'checking' && (
        <Loader
          style={{
            width: 16,
            height: 16,
            flexShrink: 0,
            color: C.mutedText,
            animation: 'cib-spin 1s linear infinite',
          }}
        />
      )}
      {status === 'connected' && (
        <CheckCircle style={{ width: 16, height: 16, flexShrink: 0, color: C.teal }} />
      )}
      {status === 'disconnected' && (
        <Circle style={{ width: 16, height: 16, flexShrink: 0, color: C.mutedText, opacity: 0.5 }} />
      )}
      <span
        style={{
          fontSize: 14,
          color: status === 'connected' ? C.white : C.mutedText,
        }}
      >
        {tool.label}
      </span>
    </div>
  );
}

export default function Sidebar({ activeChannel, alertCount, onChannelChange, onAlertsClick }: SidebarProps) {
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <>
      <style>{`@keyframes cib-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div
        style={{
          width: 250,
          minWidth: 250,
          maxWidth: 250,
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: C.sidebarBg,
          color: C.white,
          borderRight: `1px solid ${C.sidebarBorder}`,
          overflowY: 'auto',
          flexShrink: 0,
        }}
      >
        {/* Workspace header */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: `1px solid ${C.sidebarBorder}`,
            minHeight: 56,
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Neumm logo */}
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="ng-sb" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#4DD9C0"/>
                  <stop offset="100%" stopColor="#3A7BD5"/>
                </linearGradient>
              </defs>
              <rect width="28" height="28" rx="7" fill="url(#ng-sb)"/>
              <path d="M6.5 21.5V6.5h3.1l9.8 13V6.5H22.5v15H19.4L9.6 8.5V21.5H6.5z" fill="white"/>
            </svg>
            <span style={{ fontWeight: 700, fontSize: 16, color: C.white, letterSpacing: '-0.02em' }}>
              Neumm
            </span>
          </div>
          <ChevronDown style={{ width: 16, height: 16, color: C.mutedText }} />
        </div>

        {/* Alerts */}
        <button
          onClick={onAlertsClick}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            width: '100%',
            textAlign: 'left',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: alertCount > 0 ? C.white : C.mutedText,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.sidebarHover)}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Bell style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 14, fontWeight: 500 }}>Alerts</span>
          </div>
          {alertCount > 0 ? (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                borderRadius: 999,
                padding: '2px 6px',
                minWidth: 20,
                textAlign: 'center',
                backgroundColor: '#FFFFFF',
                color: C.alertRed,
              }}
            >
              {alertCount}
            </span>
          ) : (
            <span
              style={{
                fontSize: 12,
                borderRadius: 999,
                padding: '2px 6px',
                backgroundColor: C.sidebarHover,
                color: C.mutedText,
              }}
            >
              0
            </span>
          )}
        </button>

        {/* Streams section label */}
        <div style={{ padding: '16px 16px 4px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.mutedText, margin: 0 }}>
            Streams
          </p>
        </div>

        {/* Stream channel buttons */}
        <div style={{ marginBottom: 8 }}>
          {STREAMS.map((ch) => {
            const isActive = activeChannel === ch.id;
            return (
              <button
                key={ch.id}
                onClick={() => onChannelChange(ch.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  margin: '0 4px',
                  width: 'calc(100% - 8px)',
                  textAlign: 'left',
                  backgroundColor: isActive ? C.activeItem : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: C.white,
                  fontWeight: isActive ? 700 : 400,
                  boxShadow: isActive ? `inset 3px 0 0 ${C.white}` : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = C.activeItem;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <Waves style={{ width: 16, height: 16, flexShrink: 0, opacity: isActive ? 1 : 0.7 }} />
                <span style={{ fontSize: 14 }}>{ch.label}</span>
              </button>
            );
          })}
        </div>

        {/* Monitoring section label */}
        <div style={{ padding: '16px 16px 4px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.mutedText, margin: 0 }}>
            Monitoring
          </p>
        </div>

        {/* Tool status rows */}
        <div style={{ marginBottom: 8 }}>
          {MONITORING_TOOLS.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </div>

        {/* Push bottom links to bottom */}
        <div style={{ flex: 1 }} />

        {/* Bottom links */}
        <div style={{ borderTop: `1px solid ${C.sidebarBorder}` }}>
          <button
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: C.mutedText,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = C.sidebarHover; e.currentTarget.style.color = C.white; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = C.mutedText; }}
          >
            <HelpCircle style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 14 }}>Help</span>
          </button>

          <button
            onClick={() => router.push('/settings')}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: C.mutedText,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = C.sidebarHover; e.currentTarget.style.color = C.white; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = C.mutedText; }}
          >
            <Settings style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 14 }}>Settings</span>
          </button>

          {/* User profile + logout */}
          {user && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                borderTop: `1px solid ${C.sidebarBorder}`,
              }}
            >
              {/* Avatar */}
              {user.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar_url}
                  alt={user.name}
                  style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }}
                />
              ) : (
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: '#4A90D9',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {user.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: C.white, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.name}
                </p>
                <p style={{ fontSize: 11, color: C.mutedText, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.email}
                </p>
              </div>
              <button
                onClick={logout}
                title="Sign out"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: C.mutedText,
                  padding: 4,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#E05555'; e.currentTarget.style.backgroundColor = 'rgba(224,85,85,0.12)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.mutedText; e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <LogOut style={{ width: 15, height: 15 }} />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
