"use client";

import { useState, useEffect } from "react";
import { User, FileText, AlertTriangle, Sparkles, Bot, RefreshCw, XCircle, WifiOff, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import type { ApiErrorCode } from "@/lib/api";

export interface ChatMessageData {
  id: string;
  type: "user" | "bot";
  text: string;
  timestamp: string;
  isLoading?: boolean;
  isStreaming?: boolean;
  confidence?: number;
  sources?: string[];
  answeredAt?: number;
  isError?: boolean;
  errorCode?: ApiErrorCode;
}

interface ChatMessageProps {
  message: ChatMessageData;
  personaName: string;
  personaIcon: LucideIcon;
  onRetry?: (originalQuestion: string) => void;
  originalQuestion?: string; // The question that triggered this bot response
}

// ─── Relative time display ───

function TimeAgo({ answeredAt }: { answeredAt: number }) {
  const [timeAgo, setTimeAgo] = useState("");

  useEffect(() => {
    function update() {
      const diff = Math.floor((Date.now() - answeredAt) / 1000);
      if (diff < 5) setTimeAgo("just now");
      else if (diff < 60) setTimeAgo(`${diff}s ago`);
      else if (diff < 3600) setTimeAgo(`${Math.floor(diff / 60)}m ago`);
      else setTimeAgo(`${Math.floor(diff / 3600)}h ago`);
    }
    update();
    const interval = setInterval(update, 5000);
    return () => clearInterval(interval);
  }, [answeredAt]);

  return (
    <span className="text-[10px] text-gray-400 italic">
      Answered {timeAgo}
    </span>
  );
}

// ─── Confidence badge with color coding ───

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);

  let colorClasses: string;
  let showWarning = false;

  if (percent >= 80) {
    colorClasses = "bg-success/10 text-success border-success/20";
  } else if (percent >= 60) {
    colorClasses = "bg-yellow-50 text-yellow-700 border-yellow-200";
  } else {
    colorClasses = "bg-warning/10 text-warning border-warning/20";
    showWarning = true;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-all",
        colorClasses
      )}
    >
      {showWarning && <AlertTriangle className="h-2.5 w-2.5" />}
      {percent}%
      {showWarning && <span className="hidden sm:inline"> - Limited</span>}
    </span>
  );
}

// ─── Typing indicator (bouncing dots) ───

function TypingIndicator({ personaName }: { personaName: string }) {
  return (
    <div className="mt-2 animate-fade-in">
      {/* Shimmer bar */}
      <div className="h-px w-full animate-shimmer rounded mb-3" />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5 text-accent" />
          <span className="text-xs font-medium text-gray-500">
            {personaName} is thinking
          </span>
        </div>

        {/* Bouncing dots */}
        <div className="flex gap-1 items-center">
          <span
            className="h-1.5 w-1.5 rounded-full bg-accent animate-typing-dot"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="h-1.5 w-1.5 rounded-full bg-accent animate-typing-dot"
            style={{ animationDelay: "200ms" }}
          />
          <span
            className="h-1.5 w-1.5 rounded-full bg-accent animate-typing-dot"
            style={{ animationDelay: "400ms" }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Streaming cursor ───

function StreamingCursor() {
  return (
    <span className="inline-block w-[2px] h-[14px] bg-accent animate-blink-cursor ml-0.5 align-text-bottom" />
  );
}

// ─── Markdown renderer for bot answers ───

function MarkdownAnswer({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  return (
    <div className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none prose-p:my-1.5 prose-ul:my-2 prose-li:my-0.5 prose-strong:text-gray-900 prose-strong:font-semibold">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc pl-4 my-2 space-y-1">{children}</ul>
          ),
          li: ({ children }) => (
            <li className="text-gray-700 leading-relaxed">{children}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-gray-900">{children}</strong>
          ),
          code: ({ children }) => (
            <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-xs font-mono">
              {children}
            </code>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
      {isStreaming && <StreamingCursor />}
    </div>
  );
}

// ─── Source pill (clickable style) ───

function SourcePill({ source }: { source: string }) {
  const isUploadedFile = source.includes("\u{1F4C4}");

  return (
    <button
      className={cn(
        "inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-all duration-200 cursor-pointer group border",
        isUploadedFile
          ? "text-accent bg-accent/5 hover:bg-accent/10 border-accent/15"
          : "text-gray-500 bg-gray-50 hover:bg-gray-100 border-gray-200"
      )}
      onClick={() => {
        // Future: open source detail panel
      }}
    >
      <FileText className={cn(
        "h-3 w-3 transition-colors",
        isUploadedFile ? "text-accent/60" : "text-gray-400 group-hover:text-gray-500"
      )} />
      <span className="group-hover:underline">{source}</span>
    </button>
  );
}

// ─── Error card for failed bot responses ───

function ErrorCard({
  message,
  onRetry,
  originalQuestion,
}: {
  message: ChatMessageData;
  onRetry?: (question: string) => void;
  originalQuestion?: string;
}) {
  const isNetwork = message.errorCode === "NETWORK_ERROR";
  const isTimeout = message.errorCode === "TIMEOUT";
  const isConfig = message.errorCode === "INVALID_KEY";

  const ErrorIcon = isNetwork ? WifiOff : XCircle;

  return (
    <div className="animate-scale-in">
      <div className="mt-2 bg-red-50/80 rounded-lg border border-red-200/60 shadow-card p-4">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
            <ErrorIcon className="h-4 w-4 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-800">
              {isNetwork
                ? "Connection Error"
                : isTimeout
                ? "Request Timed Out"
                : isConfig
                ? "Configuration Error"
                : "Something Went Wrong"}
            </p>
            <p className="text-xs text-red-600 mt-1 leading-relaxed">
              {message.text}
            </p>

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-3">
              {!isConfig && onRetry && originalQuestion && (
                <button
                  onClick={() => onRetry(originalQuestion)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 active:scale-95 transition-all duration-150"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              )}
              {isTimeout && (
                <span className="text-[10px] text-red-400">
                  Try a shorter or simpler question
                </span>
              )}
              {isConfig && (
                <span className="text-[10px] text-red-400">
                  Check .env.local API keys
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {message.answeredAt && (
        <div className="mt-1.5 ml-1">
          <TimeAgo answeredAt={message.answeredAt} />
        </div>
      )}
    </div>
  );
}

// ─── Main ChatMessage component ───

export function ChatMessage({
  message,
  personaName,
  personaIcon: PersonaIcon,
  onRetry,
  originalQuestion,
}: ChatMessageProps) {
  const isUser = message.type === "user";

  return (
    <div
      className={cn(
        "flex gap-3 py-3 px-2 rounded-lg transition-all duration-200 animate-fade-in",
        isUser
          ? "hover:bg-black/[0.02]"
          : message.isLoading
            ? ""
            : message.isError
              ? "hover:bg-red-50/30"
              : "hover:bg-black/[0.02]"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200",
          isUser
            ? "bg-accent"
            : message.isError
              ? "bg-red-400"
              : "bg-sidebar",
          message.isLoading && !isUser && "animate-pulse-ring"
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-white" />
        ) : message.isError ? (
          <AlertTriangle className="h-4 w-4 text-white" />
        ) : (
          <PersonaIcon className="h-4 w-4 text-white" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-gray-900 text-sm">
            {isUser ? "You" : `${personaName} Bot`}
          </span>
          <span className="text-[11px] text-gray-400">{message.timestamp}</span>
          {!isUser && !message.isLoading && !message.isStreaming && !message.isError && message.confidence !== undefined && (
            <ConfidenceBadge confidence={message.confidence} />
          )}
        </div>

        {/* Loading state */}
        {message.isLoading && !message.isStreaming ? (
          <TypingIndicator personaName={personaName} />
        ) : message.isError ? (
          <ErrorCard
            message={message}
            onRetry={onRetry}
            originalQuestion={originalQuestion}
          />
        ) : (
          <>
            {/* Message body */}
            {isUser ? (
              <p className="mt-1.5 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {message.text}
              </p>
            ) : (
              <div className={message.isStreaming ? "animate-fade-in" : "animate-scale-in"}>
                {/* Answer card */}
                <div className="mt-2 bg-white rounded-lg border border-gray-100 shadow-card p-4">
                  <MarkdownAnswer text={message.text} isStreaming={message.isStreaming} />

                  {/* Sources row — only show after streaming is complete */}
                  {!message.isStreaming && message.sources && message.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 animate-fade-in">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="h-3 w-3 text-gray-400" />
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                          Sources
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {message.sources.map((source, i) => (
                          <SourcePill key={i} source={source} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Timestamp below card — only after streaming */}
                {!message.isStreaming && message.answeredAt && (
                  <div className="mt-1.5 ml-1">
                    <TimeAgo answeredAt={message.answeredAt} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
