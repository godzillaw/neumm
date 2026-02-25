import { logError, type ErrorType } from "@/lib/error-logger";

// ─── Error classification ───

export type ApiErrorCode =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_KEY"
  | "AI_ERROR"
  | "VALIDATION"
  | "SERVER_ERROR"
  | "UNKNOWN";

export class ApiError extends Error {
  code: ApiErrorCode;
  userMessage: string;

  constructor(code: ApiErrorCode, userMessage: string, technicalMessage?: string) {
    super(technicalMessage || userMessage);
    this.name = "ApiError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

function classifyError(error: unknown, context: string): ApiError {
  // Network errors (offline / DNS / CORS)
  if (error instanceof TypeError && (error.message.includes("fetch") || error.message.includes("network") || error.message.includes("Failed"))) {
    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    const errorType: ErrorType = "NETWORK";
    logError(errorType, `Network error during ${context}`, { offline: isOffline });

    if (isOffline) {
      return new ApiError(
        "NETWORK_ERROR",
        "You appear to be offline. Please check your connection and try again.",
        error.message
      );
    }
    return new ApiError(
      "NETWORK_ERROR",
      "Couldn't reach the server. Please check your connection and try again.",
      error.message
    );
  }

  // AbortError (timeout)
  if (error instanceof DOMException && error.name === "AbortError") {
    logError("TIMEOUT", `Request timed out during ${context}`);
    return new ApiError(
      "TIMEOUT",
      "This is taking too long. Try asking a simpler question.",
      "Request aborted"
    );
  }

  // Already an ApiError
  if (error instanceof ApiError) {
    return error;
  }

  // Generic error
  logError("UNKNOWN", `Unexpected error during ${context}`, {
    error: error instanceof Error ? error.message : String(error),
  });
  return new ApiError(
    "UNKNOWN",
    "Something unexpected went wrong. Please try again.",
    error instanceof Error ? error.message : String(error)
  );
}

// ─── API response types ───

export interface AnswerResponse {
  answer: string;
  confidence: number;
  sources: string[];
}

export interface UploadResponse {
  success: boolean;
  filename: string;
  message: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── SSE event types (matching server) ───

interface SSEChunkEvent {
  type: "chunk";
  text: string;
}

interface SSEDoneEvent {
  type: "done";
  confidence: number;
  sources: string[];
  followups: string[];
}

interface SSEErrorEvent {
  type: "error";
  error: string;
  errorCode?: string;
}

type SSEEvent = SSEChunkEvent | SSEDoneEvent | SSEErrorEvent;

// ─── Streaming API client ───

const STREAM_TIMEOUT_MS = 60000; // 60 seconds for streaming

export async function fetchAnswerStream(
  question: string,
  persona: string,
  conversationHistory: ConversationMessage[],
  onChunk: (text: string) => void,
  onDone: (confidence: number, sources: string[], followups: string[]) => void
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  try {
    const res = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, persona, conversationHistory }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      const serverError = errorBody as { error?: string; errorCode?: string };

      if (serverError.errorCode === "INVALID_KEY") {
        throw new ApiError("INVALID_KEY", "Configuration error. Please check API keys.", serverError.error);
      }
      if (serverError.errorCode === "TIMEOUT") {
        throw new ApiError("TIMEOUT", "This is taking too long. Try asking a simpler question.", serverError.error);
      }
      if (res.status === 400) {
        throw new ApiError("VALIDATION", serverError.error || "Invalid request.", serverError.error);
      }
      throw new ApiError("SERVER_ERROR", "Couldn't get an answer. Please try again.", `Status ${res.status}`);
    }

    if (!res.body) {
      throw new ApiError("SERVER_ERROR", "No response stream available.", "Missing response body");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || ""; // Keep incomplete chunk in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr) as SSEEvent;

          switch (event.type) {
            case "chunk":
              onChunk(event.text);
              break;
            case "done":
              onDone(event.confidence, event.sources, event.followups);
              break;
            case "error": {
              const code = (event.errorCode as ApiErrorCode) || "AI_ERROR";
              throw new ApiError(code, event.error);
            }
          }
        } catch (parseError) {
          if (parseError instanceof ApiError) throw parseError;
          // Skip malformed SSE events
          console.warn("[fetchAnswerStream] Malformed SSE event:", jsonStr);
        }
      }
    }
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof ApiError) {
      throw error;
    }
    throw classifyError(error, "fetchAnswerStream");
  }
}

// ─── Legacy non-streaming API client (kept for compatibility) ───

const ANSWER_TIMEOUT_MS = 20000; // 20 seconds for AI calls

export async function fetchAnswer(
  question: string,
  persona: string
): Promise<AnswerResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANSWER_TIMEOUT_MS);

  try {
    const res = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, persona }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      const serverError = (errorBody as { error?: string; errorCode?: string });

      // Map server error codes to ApiError
      if (serverError.errorCode === "INVALID_KEY") {
        logError("API_KEY", "Invalid API key", { persona });
        throw new ApiError(
          "INVALID_KEY",
          "Configuration error. Please check API keys.",
          serverError.error
        );
      }

      if (serverError.errorCode === "TIMEOUT") {
        logError("TIMEOUT", "Server-side AI timeout", { persona });
        throw new ApiError(
          "TIMEOUT",
          "This is taking too long. Try asking a simpler question.",
          serverError.error
        );
      }

      if (serverError.errorCode === "AI_ERROR") {
        logError("AI_ERROR", "AI service error", { persona, error: serverError.error });
        throw new ApiError(
          "AI_ERROR",
          "Oops! Couldn't get an answer. Please try again.",
          serverError.error
        );
      }

      if (res.status === 400) {
        logError("VALIDATION", "Validation error", { error: serverError.error });
        throw new ApiError(
          "VALIDATION",
          serverError.error || "Invalid request. Please try again.",
          serverError.error
        );
      }

      // Generic server error
      logError("SERVER", `Server error ${res.status}`, { error: serverError.error });
      throw new ApiError(
        "SERVER_ERROR",
        "Oops! Couldn't get an answer. Please try again.",
        serverError.error || `Status ${res.status}`
      );
    }

    return res.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof ApiError) {
      throw error;
    }
    throw classifyError(error, "fetchAnswer");
  }
}

// ─── Updates API types ───

export interface UpdateFileInfo {
  filename: string;
  type: string;
  size: number;
}

export interface CIBUpdateResponse {
  id: string;
  topic: string;
  content: string;
  files: UpdateFileInfo[];
  author: string;
  timestamp: string;
  superseded: boolean;
  supersededBy?: string;
}

// ─── Updates API client ───

const UPDATES_TIMEOUT_MS = 30000;

export async function fetchUpdates(): Promise<CIBUpdateResponse[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPDATES_TIMEOUT_MS);

  try {
    const res = await fetch("/api/updates", {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new ApiError("SERVER_ERROR", "Failed to load updates.", `Status ${res.status}`);
    }

    const data = await res.json();
    return data.updates || [];
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof ApiError) throw error;
    throw classifyError(error, "fetchUpdates");
  }
}

export async function submitUpdate(
  topic: string,
  content: string,
  files: File[],
  author?: string
): Promise<{ success: boolean; update: CIBUpdateResponse; message: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPDATES_TIMEOUT_MS);

  const formData = new FormData();
  formData.append("topic", topic);
  formData.append("content", content);
  if (author) formData.append("author", author);
  for (const file of files) {
    formData.append("files", file);
  }

  try {
    const res = await fetch("/api/updates", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new ApiError("SERVER_ERROR", errBody.error || "Failed to save update.", `Status ${res.status}`);
    }

    return res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof ApiError) throw error;
    throw classifyError(error, "submitUpdate");
  }
}

export async function deleteUpdate(id: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPDATES_TIMEOUT_MS);

  try {
    const res = await fetch(`/api/updates?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new ApiError("SERVER_ERROR", "Failed to delete update.", `Status ${res.status}`);
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof ApiError) throw error;
    throw classifyError(error, "deleteUpdate");
  }
}

// ─── Upload API client ───

const UPLOAD_TIMEOUT_MS = 30000; // 30 seconds for uploads

export async function uploadFile(file: File): Promise<UploadResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorBody: UploadResponse = await res.json().catch(() => ({
        success: false,
        filename: file.name,
        message: `Upload failed with status ${res.status}`,
      }));

      logError("UPLOAD", `Upload failed: ${errorBody.message}`, {
        filename: file.name,
        status: res.status,
      });

      throw new ApiError(
        "SERVER_ERROR",
        errorBody.message || "Upload failed. Please try again.",
        `Upload error ${res.status}`
      );
    }

    return res.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof ApiError) {
      throw error;
    }
    throw classifyError(error, "uploadFile");
  }
}
