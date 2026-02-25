'use client';

import { AlertTriangle } from 'lucide-react';

interface DiscrepancyAlertProps {
  title: string;
  severity: 'high' | 'medium' | 'low';
  documented: string;
  actual: string;
  recommendation?: string;
}

const SEVERITY_STYLES = {
  high: {
    bg: '#FBE9EF',
    border: '#E01E5A',
    iconColor: '#E01E5A',
    label: 'High',
    labelBg: '#E01E5A',
  },
  medium: {
    bg: '#FFF9E6',
    border: '#ECB22E',
    iconColor: '#ECB22E',
    label: 'Medium',
    labelBg: '#ECB22E',
  },
  low: {
    bg: '#E8F4FD',
    border: '#1264A3',
    iconColor: '#1264A3',
    label: 'Low',
    labelBg: '#1264A3',
  },
};

export default function DiscrepancyAlert({
  title,
  severity,
  documented,
  actual,
  recommendation,
}: DiscrepancyAlertProps) {
  const style = SEVERITY_STYLES[severity];

  return (
    <div
      className="rounded-lg p-3 text-sm"
      style={{
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
      }}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="w-4 h-4 mt-0.5 flex-shrink-0"
          style={{ color: style.iconColor }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: style.labelBg, color: '#FFFFFF' }}
            >
              {style.label}
            </span>
            <span className="font-semibold" style={{ color: '#1D1C1D' }}>
              {title}
            </span>
          </div>
          <div className="space-y-1">
            <p style={{ color: '#616061' }}>
              <span className="font-medium" style={{ color: '#1D1C1D' }}>Documented: </span>
              {documented}
            </p>
            <p style={{ color: '#616061' }}>
              <span className="font-medium" style={{ color: '#1D1C1D' }}>Actual: </span>
              {actual}
            </p>
            {recommendation && (
              <p className="mt-1.5 font-medium" style={{ color: '#1D1C1D' }}>
                Recommendation: {recommendation}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
