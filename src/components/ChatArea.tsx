'use client';

import { useEffect, useRef } from 'react';
import { Waves } from 'lucide-react';
import Message, { type MessageData } from './Message';

interface ChatAreaProps {
  channel: string;
  messages: MessageData[];
  isLoading: boolean;
  streamingContent: string;
}

export default function ChatArea({ channel, messages, isLoading, streamingContent }: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, isLoading]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Channel header */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          padding: '12px 24px',
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #E0E0E0',
          minHeight: 56,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Waves style={{ width: 20, height: 20, color: '#4A90D9' }} />
          <span style={{ fontSize: 20, fontWeight: 700, color: '#1D1C1D' }}>
            {channel}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, color: '#616061' }}>
            Neumm
          </span>
        </div>
      </div>

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          backgroundColor: '#FFFFFF',
          scrollbarWidth: 'thin',
        }}
      >
        <div style={{ paddingTop: 16, paddingBottom: 16 }}>
          {messages.map((msg) => (
            <Message key={msg.id} {...msg} />
          ))}

          {/* Streaming message (in-progress) */}
          {streamingContent && (
            <Message
              role="assistant"
              content={streamingContent}
              timestamp={new Date().toISOString()}
            />
          )}

          {/* Loading dots */}
          {isLoading && !streamingContent && (
            <div style={{ display: 'flex', flexDirection: 'row', gap: 12, padding: '8px 24px' }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, borderRadius: 4 }}>
                <defs>
                  <linearGradient id="ng-chat" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#4DD9C0"/>
                    <stop offset="100%" stopColor="#3A7BD5"/>
                  </linearGradient>
                </defs>
                <rect width="32" height="32" rx="4" fill="url(#ng-chat)"/>
                <path d="M8 24V8h3.4L20 19.5V8H22.8v16H19.4L11 12.5V24H8z" fill="white"/>
              </svg>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: '#616061',
                      animation: `cib-dot 1.4s ease-in-out infinite`,
                      animationDelay: `${i * 0.15}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
