'use client';


import { Settings } from 'lucide-react';
import { type Persona } from '@/lib/personas';

export type AppMode = 'ask' | 'update';

export interface SidebarProps {
  selectedPersona: Persona | null;
  onSelectPersona: (persona: Persona) => void;
  isOpen: boolean;
  onClose: () => void;
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

const PERSONAS = [
  { id: 'product-manager', name: 'Product Manager', icon: '📋' },
  { id: 'tech-lead', name: 'Tech Lead', icon: '⚙️' },
  { id: 'cto', name: 'CTO', icon: '🎯' },
  { id: 'developer', name: 'Developer', icon: '💻' },
];

export function Sidebar({
  selectedPersona,
  onSelectPersona,
  isOpen,
  onClose,
  mode,
  onModeChange,
}: SidebarProps) {
  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`flex flex-col h-screen transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } fixed lg:relative z-50 lg:z-auto`}
        style={{
          width: 250,
          minWidth: 250,
          backgroundColor: '#3F0E40',
          color: '#FFFFFF',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid #461447', minHeight: 56 }}
        >
          {/* Neumm logo */}
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ borderRadius: 6, flexShrink: 0 }}>
            <defs>
              <linearGradient id="ng-sdb" x1="0" y1="0" x2="26" y2="26" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#4DD9C0"/>
                <stop offset="100%" stopColor="#3A7BD5"/>
              </linearGradient>
            </defs>
            <rect width="26" height="26" rx="6.5" fill="url(#ng-sdb)"/>
            <path d="M5.5 20.5V5.5h3L19 18V5.5H21.5V20.5h-3L8 8v12.5H5.5z" fill="white"/>
          </svg>
          <span className="font-bold text-base" style={{ color: '#FFFFFF' }}>
            Neumm
          </span>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 p-2">
          <button
            onClick={() => onModeChange('ask')}
            className="flex-1 py-1.5 rounded text-sm font-medium transition-colors"
            style={{
              backgroundColor: mode === 'ask' ? '#1264A3' : 'transparent',
              color: mode === 'ask' ? '#FFFFFF' : '#BCA9BD',
            }}
          >
            Ask
          </button>
          <button
            onClick={() => onModeChange('update')}
            className="flex-1 py-1.5 rounded text-sm font-medium transition-colors"
            style={{
              backgroundColor: mode === 'update' ? '#1264A3' : 'transparent',
              color: mode === 'update' ? '#FFFFFF' : '#BCA9BD',
            }}
          >
            Update
          </button>
        </div>

        {/* Personas */}
        <div className="px-4 pt-2 pb-1">
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#BCA9BD' }}>
            Personas
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {PERSONAS.map((p) => {
            const isActive = selectedPersona?.id === p.id;
            return (
              <button
                key={p.id}
                onClick={() =>
                  onSelectPersona({ id: p.id, name: p.name } as Persona)
                }
                className="flex items-center gap-2 py-1.5 w-full text-left px-4 transition-colors"
                style={{
                  backgroundColor: isActive ? '#1264A3' : 'transparent',
                  color: isActive ? '#FFFFFF' : '#BCA9BD',
                  fontWeight: isActive ? 700 : 400,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#461447';
                    (e.currentTarget as HTMLElement).style.color = '#FFFFFF';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = '#BCA9BD';
                  }
                }}
              >
                <span>{p.icon}</span>
                <span className="text-sm">{p.name}</span>
              </button>
            );
          })}
        </div>

        {/* Bottom */}
        <div style={{ borderTop: '1px solid #461447' }}>
          <button
            className="flex items-center gap-2 px-4 py-3 w-full text-left"
            style={{ color: '#BCA9BD' }}
          >
            <Settings className="w-4 h-4" />
            <span className="text-sm">Settings</span>
          </button>
        </div>
      </div>
    </>
  );
}

export default Sidebar;
