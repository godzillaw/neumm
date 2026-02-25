'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, Loader, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'error';

export interface IntegrationField {
  key: string;           // env var name e.g. GITHUB_TOKEN
  label: string;         // display label
  placeholder: string;
  type: 'text' | 'password' | 'email';
  helpText?: string;
}

interface IntegrationCardProps {
  id: 'github' | 'jira' | 'confluence' | 'slack' | 'teams';
  title: string;
  description: string;
  icon: React.ReactNode;
  accentColor: string;
  fields: IntegrationField[];
  initialValues: Record<string, string>;
  initialStatus: ConnectionStatus;
  connectedDetails?: Record<string, string> | null;
  helpUrl: string;
  onSave: (values: Record<string, string>) => Promise<{ success: boolean; error?: string; details?: Record<string, string> }>;
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg: '#F8FAFF',
  card: '#FFFFFF',
  border: '#E2EAF4',
  borderFocus: '#4A90D9',
  navy: '#1B3A6B',
  blue: '#4A90D9',
  teal: '#38B2AC',
  red: '#E05555',
  muted: '#6B7A99',
  label: '#374151',
  inputBg: '#F9FAFB',
};

// ─── Password field with show/hide toggle ─────────────────────────────────────

function SecretInput({ value, onChange, placeholder, disabled }: {
  value: string; onChange: (v: string) => void;
  placeholder: string; disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full text-sm rounded-lg px-3 py-2 outline-none transition-all"
        style={{
          border: `1px solid ${C.border}`,
          backgroundColor: disabled ? '#F3F4F6' : C.inputBg,
          color: C.navy,
          paddingRight: 36,
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = C.borderFocus)}
        onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2"
        style={{ color: C.muted }}
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, error }: { status: ConnectionStatus; error?: string }) {
  if (status === 'idle') return null;
  if (status === 'testing') return (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: C.blue }}>
      <Loader className="w-3.5 h-3.5 animate-spin" /> Testing connection…
    </div>
  );
  if (status === 'connected') return (
    <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: C.teal }}>
      <CheckCircle className="w-3.5 h-3.5" /> Connected
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: C.red }}>
      <XCircle className="w-3.5 h-3.5" />
      <span>{error || 'Connection failed'}</span>
    </div>
  );
}

// ─── Main IntegrationCard ─────────────────────────────────────────────────────

export default function IntegrationCard({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  id: _id, title, description, icon, accentColor,
  fields, initialValues, initialStatus, connectedDetails,
  helpUrl, onSave,
}: IntegrationCardProps) {
  const [expanded, setExpanded] = useState(initialStatus !== 'connected');
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [status, setStatus] = useState<ConnectionStatus>(initialStatus);
  const [error, setError] = useState<string | undefined>();
  const [details, setDetails] = useState<Record<string, string> | null>(connectedDetails ?? null);
  const [saving, setSaving] = useState(false);

  const hasValues = fields.every((f) => {
    // optional fields: domain is pre-set, email is pre-set
    const v = values[f.key] || '';
    // token fields must be non-empty
    if (f.type === 'password') return v.length > 0;
    return v.length > 0;
  });

  async function handleSave() {
    setSaving(true);
    setStatus('testing');
    setError(undefined);
    try {
      const result = await onSave(values);
      if (result.success) {
        setStatus('connected');
        setDetails(result.details ?? null);
        setExpanded(false);
      } else {
        setStatus('error');
        setError(result.error);
      }
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleDisconnect() {
    // Clear all secret fields
    const cleared = { ...values };
    for (const f of fields) {
      if (f.type === 'password') cleared[f.key] = '';
    }
    setValues(cleared);
    setStatus('idle');
    setDetails(null);
    setExpanded(true);
    onSave(cleared).catch(() => {/* best-effort clear */});
  }

  const isConnected = status === 'connected';

  return (
    <div
      className="rounded-2xl overflow-hidden mb-4 transition-shadow"
      style={{
        border: `1px solid ${isConnected ? C.teal : C.border}`,
        backgroundColor: C.card,
        boxShadow: isConnected ? `0 0 0 1px ${C.teal}22` : '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      {/* Card header */}
      <button
        className="w-full flex items-center gap-4 px-6 py-4 text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Icon with accent bg */}
        <div
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${accentColor}18`, color: accentColor }}
        >
          {icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" style={{ color: C.navy }}>{title}</span>
            {isConnected && details?.user && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${C.teal}18`, color: C.teal }}>
                {details.user}
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: C.muted }}>{description}</p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <StatusBadge status={status} error={error} />
          {expanded
            ? <ChevronUp className="w-4 h-4" style={{ color: C.muted }} />
            : <ChevronDown className="w-4 h-4" style={{ color: C.muted }} />}
        </div>
      </button>

      {/* Expanded form */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '20px 24px' }}>
          {/* Connected details panel */}
          {isConnected && details && (
            <div className="mb-4 p-3 rounded-xl text-sm"
              style={{ backgroundColor: `${C.teal}0D`, border: `1px solid ${C.teal}33` }}>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4" style={{ color: C.teal }} />
                <span className="font-semibold" style={{ color: C.teal }}>Connected successfully</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {Object.entries(details).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-xs" style={{ color: C.muted }}>{k}: </span>
                    <span className="text-xs font-medium" style={{ color: C.navy }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fields */}
          <div className="space-y-3 mb-4">
            {fields.map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-medium mb-1" style={{ color: C.label }}>
                  {field.label}
                </label>
                {field.type === 'password' ? (
                  <SecretInput
                    value={values[field.key] || ''}
                    onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                    placeholder={field.placeholder}
                    disabled={saving}
                  />
                ) : (
                  <input
                    type={field.type}
                    value={values[field.key] || ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    disabled={saving}
                    className="w-full text-sm rounded-lg px-3 py-2 outline-none transition-all"
                    style={{
                      border: `1px solid ${C.border}`,
                      backgroundColor: saving ? '#F3F4F6' : C.inputBg,
                      color: C.navy,
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = C.borderFocus)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
                  />
                )}
                {field.helpText && (
                  <p className="text-xs mt-1" style={{ color: C.muted }}>{field.helpText}</p>
                )}
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !hasValues}
              className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-opacity"
              style={{
                backgroundColor: hasValues && !saving ? C.blue : '#D1D5DB',
                color: '#FFFFFF',
                cursor: hasValues && !saving ? 'pointer' : 'not-allowed',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving && <Loader className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Testing…' : isConnected ? 'Re-test & Save' : 'Connect'}
            </button>

            {isConnected && (
              <button
                onClick={handleDisconnect}
                className="text-sm px-4 py-2 rounded-lg transition-colors"
                style={{ color: C.red, border: `1px solid ${C.red}44` }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${C.red}0D`)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                Disconnect
              </button>
            )}

            <a
              href={helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs ml-auto"
              style={{ color: C.blue }}
            >
              How to get a token →
            </a>
          </div>

          {/* Error message */}
          {status === 'error' && error && (
            <div className="mt-3 p-3 rounded-lg text-xs" style={{
              backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: C.red,
            }}>
              <strong>Connection failed:</strong> {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
