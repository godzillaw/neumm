'use client';

import { useState } from 'react';
import { X, ChevronDown, ChevronUp, AlertTriangle, CheckCircle } from 'lucide-react';

export interface AlertData {
  id: string;
  type: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  documented: string;
  actual: string;
  sources: string[];
  recommendation?: string;
  resolved: boolean;
  detected_at: string;
}

interface AlertsPanelProps {
  isOpen: boolean;
  alerts: AlertData[];
  onClose: () => void;
  onResolve: (id: string) => void;
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const SEVERITY_STYLES = {
  high: {
    bg: '#FEECEC',
    border: '#E05555',
    text: '#B03030',
    label: 'High',
  },
  medium: {
    bg: '#FFF9E6',
    border: '#ECB22E',
    text: '#856404',
    label: 'Medium',
  },
  low: {
    bg: '#EBF3FB',
    border: '#4A90D9',
    text: '#2272C3',
    label: 'Low',
  },
};

function AlertItem({
  alert,
  onResolve,
}: {
  alert: AlertData;
  onResolve: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const style = SEVERITY_STYLES[alert.severity];

  return (
    <div
      style={{
        borderRadius: 8,
        marginBottom: 12,
        overflow: 'hidden',
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
      }}
    >
      {/* Alert header */}
      <button
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 12,
          padding: 12,
          textAlign: 'left',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <AlertTriangle style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0, color: style.border }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                backgroundColor: style.border,
                color: '#FFFFFF',
              }}
            >
              {style.label}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#1D1C1D' }}>
              {alert.title}
            </span>
          </div>
          <p style={{ fontSize: 12, marginTop: 4, color: '#616061', margin: '4px 0 0' }}>
            Detected {alert.detected_at.replace('T', ' ').slice(0, 16)} UTC
          </p>
        </div>
        <div style={{ flexShrink: 0, marginTop: 2, color: '#616061' }}>
          {expanded
            ? <ChevronUp style={{ width: 16, height: 16 }} />
            : <ChevronDown style={{ width: 16, height: 16 }} />
          }
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: style.text, margin: '0 0 2px' }}>
              Documented
            </p>
            <p style={{ fontSize: 14, color: '#1D1C1D', margin: 0 }}>{alert.documented}</p>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: style.text, margin: '0 0 2px' }}>
              Actual
            </p>
            <p style={{ fontSize: 14, color: '#1D1C1D', margin: 0 }}>{alert.actual}</p>
          </div>
          {alert.recommendation && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: style.text, margin: '0 0 2px' }}>
                Recommendation
              </p>
              <p style={{ fontSize: 14, color: '#1D1C1D', margin: 0 }}>{alert.recommendation}</p>
            </div>
          )}
          {alert.sources.length > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: style.text, margin: '0 0 4px' }}>
                Sources
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {alert.sources.map((src, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 12,
                      padding: '2px 8px',
                      borderRadius: 999,
                      backgroundColor: 'rgba(0,0,0,0.08)',
                      color: '#1D1C1D',
                    }}
                  >
                    {src}
                  </span>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={() => onResolve(alert.id)}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              fontSize: 14,
              padding: '6px 12px',
              borderRadius: 4,
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: '#4A90D9',
              color: '#FFFFFF',
              alignSelf: 'flex-start',
            }}
          >
            <CheckCircle style={{ width: 14, height: 14 }} />
            Mark Resolved
          </button>
        </div>
      )}
    </div>
  );
}

export default function AlertsPanel({ isOpen, alerts, onClose, onResolve }: AlertsPanelProps) {
  const sorted = [...alerts].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );

  const unresolved = sorted.filter((a) => !a.resolved);
  const resolved = sorted.filter((a) => a.resolved);

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 40,
            backgroundColor: 'rgba(0,0,0,0.3)',
          }}
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          width: 400,
          height: '100vh',
          backgroundColor: '#FFFFFF',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 300ms ease-out',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid #E0E0E0',
            minHeight: 56,
            flexShrink: 0,
          }}
        >
          <div>
            <h2 style={{ fontWeight: 700, fontSize: 16, color: '#1D1C1D', margin: 0 }}>
              Discrepancy Alerts
            </h2>
            <p style={{ fontSize: 12, color: '#616061', margin: 0 }}>
              {unresolved.length} unresolved · {resolved.length} resolved
            </p>
          </div>
          <button
            onClick={onClose}
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
              (e.currentTarget as HTMLElement).style.backgroundColor = '#F0F0F0';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {unresolved.length === 0 && resolved.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: '48px 0' }}>
              <CheckCircle style={{ width: 48, height: 48, marginBottom: 12, color: '#E0E0E0' }} />
              <p style={{ fontWeight: 600, color: '#616061', margin: 0 }}>
                No alerts
              </p>
              <p style={{ fontSize: 14, marginTop: 4, color: '#9E9E9E', margin: '4px 0 0' }}>
                Neumm will surface discrepancies as it monitors your tools.
              </p>
            </div>
          )}

          {unresolved.length > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8, color: '#616061' }}>
                Active ({unresolved.length})
              </p>
              {unresolved.map((alert) => (
                <AlertItem key={alert.id} alert={alert} onResolve={onResolve} />
              ))}
            </div>
          )}

          {resolved.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8, color: '#9E9E9E' }}>
                Resolved ({resolved.length})
              </p>
              {resolved.map((alert) => (
                <div
                  key={alert.id}
                  style={{
                    borderRadius: 8,
                    marginBottom: 8,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    backgroundColor: '#F8F8F8',
                    border: '1px solid #E0E0E0',
                    opacity: 0.7,
                  }}
                >
                  <CheckCircle style={{ width: 16, height: 16, flexShrink: 0, color: '#4CAF50' }} />
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#616061', margin: 0 }}>
                      {alert.title}
                    </p>
                    <p style={{ fontSize: 12, color: '#9E9E9E', margin: 0 }}>
                      Resolved
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
