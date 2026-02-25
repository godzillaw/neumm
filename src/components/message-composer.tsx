"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { Send, Paperclip, X, FileText, Upload, Check, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadFile, ApiError } from "@/lib/api";
import { logError } from "@/lib/error-logger";

const ACCEPTED_TYPES = ".pdf,.docx,.txt,.md";
const ACCEPTED_MIME =
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

type FileStatus = "selected" | "uploading" | "success" | "error";

interface SelectedFile {
  file: File;
  status: FileStatus;
  errorMessage?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(name: string): string {
  return name.split(".").pop()?.toUpperCase() ?? "";
}

// ─── Persona-specific placeholder text ───

const PERSONA_PLACEHOLDERS: Record<string, string> = {
  developer: "Ask Developer a question...",
  "product-manager": "Ask Product Manager a question...",
  executive: "Ask Executive a question...",
  sales: "Ask Sales a question...",
  marketing: "Ask Marketing a question...",
  "customer-support": "Ask Customer Support a question...",
  "customer-success": "Ask Customer Success a question...",
  "technical-services": "Ask Technical Services a question...",
  legal: "Ask Legal a question...",
  design: "Ask Design a question...",
};

interface MessageComposerProps {
  personaName: string;
  personaId: string;
  onSend: (message: string) => void;
  isLoading?: boolean;
  lastUserMessage?: string;
}

export function MessageComposer({
  personaName,
  personaId,
  onSend,
  isLoading = false,
  lastUserMessage,
}: MessageComposerProps) {
  const [value, setValue] = useState("");
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Auto-focus on mount and after persona change ───
  useEffect(() => {
    if (textareaRef.current && !isLoading) {
      textareaRef.current.focus();
    }
  }, [personaId, isLoading]);

  // ─── Textarea auto-resize ───
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  // ─── Send handler ───
  const handleSend = useCallback(() => {
    if (isLoading) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.focus();
      }
    });
  }, [value, onSend, isLoading]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      // Escape: clear input
      if (e.key === "Escape") {
        setValue("");
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
        });
      }
      // Up Arrow when empty: fill with last user message
      if (e.key === "ArrowUp" && value === "" && lastUserMessage) {
        e.preventDefault();
        setValue(lastUserMessage);
        requestAnimationFrame(adjustHeight);
      }
    },
    [handleSend, value, lastUserMessage, adjustHeight]
  );

  // ─── File handlers ───
  const handleFileClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_SIZE_BYTES) {
      setSelectedFile({
        file,
        status: "error",
        errorMessage: `File exceeds 10 MB limit (${formatFileSize(file.size)})`,
      });
      e.target.value = "";
      return;
    }

    const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
    const allowedExts = ACCEPTED_TYPES.split(",");
    if (!allowedExts.includes(ext)) {
      setSelectedFile({
        file,
        status: "error",
        errorMessage: "Unsupported file type. Accepted: PDF, DOCX, TXT, MD",
      });
      e.target.value = "";
      return;
    }

    setSelectedFile({ file, status: "selected" });
    e.target.value = "";
  }, []);

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!selectedFile || selectedFile.status !== "selected") return;

    setSelectedFile((prev) => (prev ? { ...prev, status: "uploading" } : null));

    try {
      const result = await uploadFile(selectedFile.file);

      if (result.success) {
        setSelectedFile((prev) =>
          prev ? { ...prev, status: "success" } : null
        );
        setTimeout(() => {
          setSelectedFile(null);
        }, 3000);
      } else {
        setSelectedFile((prev) =>
          prev
            ? { ...prev, status: "error", errorMessage: result.message }
            : null
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof ApiError
          ? error.userMessage
          : error instanceof Error
          ? error.message
          : "Upload failed. Please try again.";

      logError("UPLOAD", errorMessage, {
        filename: selectedFile.file.name,
        size: selectedFile.file.size,
      });

      setSelectedFile((prev) =>
        prev
          ? {
              ...prev,
              status: "error",
              errorMessage,
            }
          : null
      );
    }
  }, [selectedFile]);

  // ─── Auto-dismiss file errors after 5 seconds ───
  useEffect(() => {
    if (selectedFile?.status === "error") {
      const timer = setTimeout(() => {
        setSelectedFile(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [selectedFile?.status]);

  const hasContent = value.trim().length > 0;
  const placeholder = PERSONA_PLACEHOLDERS[personaId] || `Ask ${personaName} a question...`;

  return (
    <div className="px-4 sm:px-6 pb-4 pt-2 shrink-0">
      <div
        className={cn(
          "bg-white border rounded-xl transition-all duration-200 shadow-card",
          isLoading
            ? "border-gray-200 opacity-80"
            : "border-gray-200 focus-within:border-accent focus-within:shadow-[0_0_0_2px_rgba(74,144,226,0.15)]"
        )}
      >
        {/* File attachment preview */}
        {selectedFile && (
          <div className="px-5 pt-3 pb-1 animate-fade-in">
            <div
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm transition-all",
                selectedFile.status === "error"
                  ? "bg-red-50 border-red-200"
                  : selectedFile.status === "success"
                  ? "bg-success/5 border-success/20"
                  : "bg-gray-50/80 border-gray-200"
              )}
            >
              {/* Icon */}
              {selectedFile.status === "success" ? (
                <div className="h-6 w-6 rounded-full bg-success/10 flex items-center justify-center">
                  <Check className="h-3.5 w-3.5 text-success" />
                </div>
              ) : selectedFile.status === "error" ? (
                <div className="h-6 w-6 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                </div>
              ) : (
                <div className="h-6 w-6 rounded-full bg-accent/10 flex items-center justify-center">
                  <FileText className="h-3.5 w-3.5 text-accent" />
                </div>
              )}

              {/* File info */}
              <div className="flex-1 min-w-0">
                {selectedFile.status === "error" ? (
                  <p className="text-xs text-red-600 truncate">
                    {selectedFile.errorMessage}
                  </p>
                ) : selectedFile.status === "success" ? (
                  <p className="text-xs text-success truncate font-medium">
                    {selectedFile.file.name} uploaded & processed
                  </p>
                ) : (
                  <p className="text-xs text-gray-700 truncate">
                    {selectedFile.file.name}
                    <span className="text-gray-400 ml-1.5">
                      ({formatFileSize(selectedFile.file.size)}) &middot;{" "}
                      {getFileExtension(selectedFile.file.name)}
                    </span>
                  </p>
                )}
              </div>

              {/* Actions */}
              {selectedFile.status === "selected" && (
                <button
                  onClick={handleUpload}
                  className="shrink-0 h-7 px-3 rounded-lg bg-accent hover:bg-accent-hover active:scale-95 text-white text-xs font-medium flex items-center gap-1.5 transition-all duration-150 shadow-sm"
                >
                  <Upload className="h-3 w-3" />
                  Upload
                </button>
              )}

              {selectedFile.status === "uploading" && (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <span className="text-xs text-gray-400 shrink-0">
                    Processing...
                  </span>
                </div>
              )}

              {/* Remove / dismiss */}
              {(selectedFile.status === "selected" ||
                selectedFile.status === "error") && (
                <button
                  onClick={handleRemoveFile}
                  className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-all"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-3 px-5 py-4">
          {/* Paperclip button */}
          <button
            onClick={handleFileClick}
            disabled={isLoading}
            aria-label="Attach file"
            className={cn(
              "shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-all duration-200 mb-px",
              isLoading
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-400 hover:text-accent hover:bg-accent/5"
            )}
            title="Attach file (PDF, DOCX, TXT, MD)"
          >
            <Paperclip className="h-5 w-5" />
          </button>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={`${ACCEPTED_TYPES},${ACCEPTED_MIME}`}
            onChange={handleFileChange}
            className="hidden"
          />

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              adjustHeight();
            }}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder={placeholder}
            aria-label={placeholder}
            rows={1}
            className={cn(
              "flex-1 text-[15px] outline-none bg-transparent text-gray-900 placeholder-gray-400 resize-none leading-relaxed py-0.5",
              isLoading && "opacity-50 cursor-not-allowed"
            )}
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!hasContent || isLoading}
            aria-label="Send message"
            title={isLoading ? "Waiting for response..." : hasContent ? "Send message" : "Type a question first"}
            className={cn(
              "shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-all duration-200",
              isLoading
                ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                : hasContent
                ? "bg-accent hover:bg-accent-hover active:scale-90 text-white cursor-pointer shadow-sm"
                : "bg-gray-100 text-gray-300 cursor-not-allowed"
            )}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Toolbar hint row */}
        <div className="flex items-center justify-between px-5 py-1.5 border-t border-gray-100">
          <span className="text-[11px] text-gray-400">
            <kbd className="px-1 py-0.5 rounded bg-gray-50 border border-gray-200 text-[10px] font-mono">
              Enter
            </kbd>{" "}
            to send &middot;{" "}
            <kbd className="px-1 py-0.5 rounded bg-gray-50 border border-gray-200 text-[10px] font-mono">
              Shift+Enter
            </kbd>{" "}
            for new line
          </span>
          <span className="text-[10px] text-gray-300 font-medium tracking-wide">Neumm</span>
        </div>
      </div>
    </div>
  );
}
