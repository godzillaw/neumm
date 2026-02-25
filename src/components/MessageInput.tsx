'use client';

import { useRef, useState, useCallback, KeyboardEvent } from 'react';
import { Paperclip, Send } from 'lucide-react';

interface MessageInputProps {
  onSend: (message: string, files?: File[]) => void;
  disabled?: boolean;
  channel?: string;
}

export default function MessageInput({ onSend, disabled, channel = 'questions' }: MessageInputProps) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 5 * 24;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    adjustHeight();
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, attachedFiles.length > 0 ? attachedFiles : undefined);
    setText('');
    setAttachedFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachedFiles(Array.from(e.target.files));
    }
  };

  const canSend = text.trim().length > 0 && !disabled;

  return (
    <div style={{ padding: '8px 24px 24px 24px' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid #E0E0E0',
          backgroundColor: '#FFFFFF',
        }}
      >
        {/* Attached files preview */}
        {attachedFiles.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '8px 12px 4px',
              flexWrap: 'wrap',
              borderBottom: '1px solid #E0E0E0',
            }}
          >
            {attachedFiles.map((f, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 4,
                  backgroundColor: '#F0F0F0',
                  color: '#1D1C1D',
                }}
              >
                <Paperclip style={{ width: 12, height: 12 }} />
                <span>{f.name}</span>
                <button
                  onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                  style={{ marginLeft: 4, fontWeight: 700, color: '#616061', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea row */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 12px' }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={`Message ${channel} stream...`}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              outline: 'none',
              fontSize: 14,
              background: 'transparent',
              border: 'none',
              color: '#1D1C1D',
              lineHeight: '24px',
              maxHeight: 120,
              overflowY: 'auto',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 12px 8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: 6,
                borderRadius: 4,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: '#616061',
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#F0F0F0';
                e.currentTarget.style.color = '#1D1C1D';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#616061';
              }}
              title="Attach file"
            >
              <Paperclip style={{ width: 16, height: 16 }} />
            </button>
            {/* File input hidden via inline style */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#9E9E9E' }}>
              Enter to send · Shift+Enter for new line
            </span>
            <button
              onClick={handleSend}
              disabled={!canSend}
              style={{
                padding: 6,
                borderRadius: 4,
                border: 'none',
                cursor: canSend ? 'pointer' : 'not-allowed',
                backgroundColor: canSend ? '#4A90D9' : '#E0E0E0',
                color: canSend ? '#FFFFFF' : '#9E9E9E',
                display: 'flex',
                alignItems: 'center',
                transition: 'background-color 0.15s',
              }}
              title="Send message"
            >
              <Send style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
