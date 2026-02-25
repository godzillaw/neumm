"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface FollowupSuggestionsProps {
  suggestions: string[];
  onAsk: (question: string) => void;
}

export function FollowupSuggestions({ suggestions, onAsk }: FollowupSuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="mt-3 ml-12 animate-fade-in">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-3 w-3 text-accent" />
        <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
          Follow-up questions
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onAsk(suggestion)}
            className={cn(
              "text-xs px-3 py-1.5 rounded-full border transition-all duration-200",
              "bg-white border-accent/20 text-accent hover:bg-accent/5 hover:border-accent/40",
              "active:scale-95 cursor-pointer"
            )}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
