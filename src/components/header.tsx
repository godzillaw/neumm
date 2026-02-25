"use client";

import { Menu, Sparkles, Edit3 } from "lucide-react";
import { type Persona } from "@/lib/personas";
import { type AppMode } from "@/components/sidebar";

interface HeaderProps {
  selectedPersona: Persona | null;
  onToggleSidebar: () => void;
  mode?: AppMode;
}

export function Header({ selectedPersona, onToggleSidebar, mode = "ask" }: HeaderProps) {
  return (
    <header className="h-14 bg-sidebar flex items-center px-4 gap-3 shrink-0 shadow-header z-30 relative">
      {/* Mobile hamburger */}
      <button
        onClick={onToggleSidebar}
        className="lg:hidden text-white/70 hover:text-white transition-colors"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Logo and branding */}
      <div className="flex items-center gap-3">
        {/* Neumm logo */}
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ borderRadius: 8, flexShrink: 0 }}>
          <defs>
            <linearGradient id="ng-hdr" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#4DD9C0"/>
              <stop offset="100%" stopColor="#3A7BD5"/>
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill="url(#ng-hdr)"/>
          <path d="M7 25V7h3.8L22 22.5V7H25v18h-3.8L10 11.5V25H7z" fill="white"/>
        </svg>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-extrabold text-white tracking-tight">
            Neumm
          </span>
          <span className="hidden sm:inline text-sm text-white/60 font-medium">
            AI-powered company intelligence
          </span>
        </div>
      </div>

      {/* Mode / persona indicator */}
      {mode === "update" ? (
        <>
          <div className="hidden sm:block h-5 w-px bg-white/20 mx-1" />
          <div className="hidden sm:flex items-center gap-1.5">
            <Edit3 className="h-3.5 w-3.5 text-ice" />
            <span className="text-sm text-white/80 font-medium">
              Update Mode
            </span>
          </div>
        </>
      ) : selectedPersona ? (
        <>
          <div className="hidden sm:block h-5 w-px bg-white/20 mx-1" />
          <div className="hidden sm:flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-ice" />
            <span className="text-sm text-white/80 font-medium">
              {selectedPersona.name}
            </span>
          </div>
        </>
      ) : null}

      {/* Right side status */}
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden md:flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs text-white/50">AI Online</span>
        </div>
      </div>
    </header>
  );
}
