'use client';

import { ExternalLink } from 'lucide-react';

interface SourcesProps {
  sources: string[];
}

export default function Sources({ sources }: SourcesProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((src, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
          style={{ backgroundColor: '#F0F0F0', color: '#616061' }}
        >
          <ExternalLink className="w-2.5 h-2.5" />
          {src}
        </span>
      ))}
    </div>
  );
}
