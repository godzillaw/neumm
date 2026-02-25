"use client";

import { useState } from "react";
import { type Question } from "@/lib/questions";
import { MessageSquare, Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuestionCardProps {
  question: Question;
  index: number;
  onAsk: (questionText: string) => void;
}

export function QuestionCard({ question, index, onAsk }: QuestionCardProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = () => {
    if (isLoading) return;
    setIsLoading(true);
    onAsk(question.text);
    setTimeout(() => setIsLoading(false), 2000);
  };

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={cn(
        "w-full text-left bg-white rounded-lg border p-4 transition-all duration-200 group opacity-0 animate-fade-in-up",
        `stagger-${Math.min(index + 1, 5)}`,
        isLoading
          ? "shadow-card cursor-wait border-accent/30 bg-accent/[0.02]"
          : "shadow-card hover:shadow-card-hover hover:-translate-y-[2px] hover:scale-[1.005] border-gray-200 hover:border-accent/30 cursor-pointer"
      )}
    >
      <div className="flex gap-3 items-start">
        {/* Icon */}
        <div
          className={cn(
            "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200",
            isLoading
              ? "bg-accent/10"
              : "bg-sidebar/[0.06] group-hover:bg-accent/10"
          )}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 text-accent animate-spin" />
          ) : (
            <MessageSquare className="h-4 w-4 text-sidebar/60 group-hover:text-accent transition-colors" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[11px] font-semibold text-gray-400 tracking-wide">
              Q{index + 1}
            </span>
            {isLoading && (
              <span className="text-[11px] text-accent font-semibold tracking-wide">
                Sending...
              </span>
            )}
          </div>
          <p
            className={cn(
              "text-sm leading-relaxed transition-colors",
              isLoading ? "text-gray-400" : "text-gray-700 group-hover:text-gray-900"
            )}
          >
            {question.text}
          </p>
        </div>

        {/* Arrow indicator on hover */}
        <div className={cn(
          "shrink-0 opacity-0 transition-all duration-200 mt-1",
          isLoading ? "hidden" : "group-hover:opacity-100 group-hover:translate-x-0 -translate-x-1"
        )}>
          <ArrowRight className="h-4 w-4 text-accent" />
        </div>
      </div>
    </button>
  );
}
