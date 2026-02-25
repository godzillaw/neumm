'use client';

import { useState } from 'react';
import { ThumbsUp, ThumbsDown, User, AlertTriangle, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export interface Source {
  label: string;
  url?: string;
}

export interface Discrepancy {
  id: string;
  type: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  documented: string;
  actual: string;
  recommendation?: string;
}

export interface MessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: string[];
  discrepancies?: Discrepancy[];
  confidence?: number;
}

type MessageProps = Omit<MessageData, 'id'>

export default function Message({ role, content, timestamp, sources, discrepancies, confidence }: MessageProps) {
  const [reaction, setReaction] = useState<'up' | 'down' | null>(null);
  const [hovered, setHovered] = useState(false);

  const ts = new Date(timestamp);
  const hours = String(ts.getUTCHours()).padStart(2, '0');
  const minutes = String(ts.getUTCMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  const isUser = role === 'user';

  const severityStyle = (severity: string) => {
    if (severity === 'high') return { bg: '#FBE9EF', border: '#E05555', icon: '#E05555' };
    if (severity === 'medium') return { bg: '#FFF9E6', border: '#ECB22E', icon: '#ECB22E' };
    return { bg: '#E8F4FD', border: '#38B2AC', icon: '#38B2AC' };
  };

  const confStyle = (conf: number) => {
    if (conf >= 0.85) return { bg: '#E8F5E9', color: '#1B5E20' };
    if (conf >= 0.65) return { bg: '#FFF9E6', color: '#856404' };
    return { bg: '#FBE9EF', color: '#B02A37' };
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 12,
        padding: '8px 24px',
        backgroundColor: hovered ? '#F8F8F8' : 'transparent',
        transition: 'background-color 0.1s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      {isUser ? (
        <div
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 2,
            backgroundColor: '#4A90D9',
            color: '#FFFFFF',
          }}
        >
          <User style={{ width: 16, height: 16 }} />
        </div>
      ) : (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, marginTop: 2, borderRadius: 4 }}>
          <defs>
            <linearGradient id="ng-msg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#4DD9C0"/>
              <stop offset="100%" stopColor="#3A7BD5"/>
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="4" fill="url(#ng-msg)"/>
          <path d="M8 24V8h3.4L20 19.5V8H22.8v16H19.4L11 12.5V24H8z" fill="white"/>
        </svg>
      )}

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header row */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#1D1C1D' }}>
            {isUser ? 'You' : 'Neumm'}
          </span>
          <span style={{ fontSize: 12, color: '#616061' }}>
            {timeStr}
          </span>
          {!isUser && confidence !== undefined && (() => {
            const cs = confStyle(confidence);
            return (
              <span style={{ fontSize: 12, padding: '2px 6px', borderRadius: 4, backgroundColor: cs.bg, color: cs.color }}>
                {Math.round(confidence * 100)}% confidence
              </span>
            );
          })()}
        </div>

        {/* Message body */}
        <div style={{ fontSize: 14, lineHeight: '1.6', color: '#1D1C1D' }}>
          {isUser ? (
            <p style={{ margin: 0 }}>{content}</p>
          ) : (
            <ReactMarkdown
              components={{
                p: ({ children }) => <p style={{ margin: '0 0 8px 0', lineHeight: 1.6 }}>{children}</p>,
                ul: ({ children }) => <ul style={{ margin: '0 0 8px 0', paddingLeft: 20, listStyleType: 'disc' }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>{children}</ol>,
                li: ({ children }) => <li style={{ fontSize: 14, marginBottom: 2, lineHeight: 1.5 }}>{children}</li>,
                strong: ({ children }) => <strong style={{ fontWeight: 600, color: '#1D1C1D' }}>{children}</strong>,
                em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                h3: ({ children }) => <h3 style={{ fontWeight: 700, fontSize: 14, margin: '12px 0 4px', color: '#1D1C1D' }}>{children}</h3>,
                h4: ({ children }) => <h4 style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 2px', color: '#1D1C1D' }}>{children}</h4>,
                code: ({ children }) => (
                  <code style={{ padding: '2px 4px', borderRadius: 3, fontSize: 12, fontFamily: 'monospace', backgroundColor: '#EBF3FB', color: '#2272C3' }}>
                    {children}
                  </code>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          )}
        </div>

        {/* Discrepancy alerts */}
        {discrepancies && discrepancies.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {discrepancies.map((d) => {
              const sc = severityStyle(d.severity);
              return (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    gap: 8,
                    padding: 12,
                    borderRadius: 4,
                    fontSize: 14,
                    backgroundColor: sc.bg,
                    border: `1px solid ${sc.border}`,
                  }}
                >
                  <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2, color: sc.icon }} />
                  <div>
                    <p style={{ fontWeight: 600, margin: '0 0 4px', color: '#1D1C1D' }}>{d.title}</p>
                    <p style={{ margin: '0 0 2px', color: '#616061' }}>Documented: {d.documented}</p>
                    <p style={{ margin: '0 0 2px', color: '#616061' }}>Actual: {d.actual}</p>
                    {d.recommendation && (
                      <p style={{ marginTop: 4, fontWeight: 500, color: '#1D1C1D', margin: 0 }}>{d.recommendation}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Sources */}
        {sources && sources.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {sources.map((src, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 999,
                  backgroundColor: '#F0F0F0',
                  color: '#616061',
                }}
              >
                <ExternalLink style={{ width: 10, height: 10 }} />
                {src}
              </span>
            ))}
          </div>
        )}

        {/* Reactions (only for Neumm messages, show on hover) */}
        {!isUser && (
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              flexDirection: 'row',
              gap: 4,
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.15s',
            }}
          >
            <button
              onClick={() => setReaction(reaction === 'up' ? null : 'up')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: 12,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: reaction === 'up' ? '#EBF3FB' : '#F0F0F0',
                color: reaction === 'up' ? '#4A90D9' : '#616061',
              }}
            >
              <ThumbsUp style={{ width: 12, height: 12 }} />
            </button>
            <button
              onClick={() => setReaction(reaction === 'down' ? null : 'down')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: 12,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: reaction === 'down' ? '#FEECEC' : '#F0F0F0',
                color: reaction === 'down' ? '#E05555' : '#616061',
              }}
            >
              <ThumbsDown style={{ width: 12, height: 12 }} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
