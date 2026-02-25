// ─── Error Logger ───
// Structured console logging with timestamp, type, and context

export type ErrorType =
  | "NETWORK"
  | "TIMEOUT"
  | "API_KEY"
  | "AI_ERROR"
  | "UPLOAD"
  | "VALIDATION"
  | "SERVER"
  | "UNKNOWN";

export interface ErrorLogEntry {
  timestamp: string;
  type: ErrorType;
  message: string;
  context?: Record<string, unknown>;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatPrefix(type: ErrorType): string {
  const icons: Record<ErrorType, string> = {
    NETWORK: "🌐",
    TIMEOUT: "⏱️",
    API_KEY: "🔑",
    AI_ERROR: "🤖",
    UPLOAD: "📁",
    VALIDATION: "✏️",
    SERVER: "🖥️",
    UNKNOWN: "❓",
  };
  return `${icons[type]} [Neumm:${type}]`;
}

export function logError(
  type: ErrorType,
  message: string,
  context?: Record<string, unknown>
): ErrorLogEntry {
  const entry: ErrorLogEntry = {
    timestamp: formatTimestamp(),
    type,
    message,
    context,
  };

  console.error(
    `${formatPrefix(type)} ${entry.timestamp} — ${message}`,
    context ? context : ""
  );

  return entry;
}

export function logWarning(
  type: ErrorType,
  message: string,
  context?: Record<string, unknown>
): void {
  console.warn(
    `${formatPrefix(type)} ${formatTimestamp()} — ${message}`,
    context ? context : ""
  );
}

export function logInfo(
  message: string,
  context?: Record<string, unknown>
): void {
  console.info(
    `ℹ️ [Neumm] ${formatTimestamp()} — ${message}`,
    context ? context : ""
  );
}
