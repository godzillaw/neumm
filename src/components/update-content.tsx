"use client";

import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type ChangeEvent } from "react";
import {
  Edit3,
  Send,
  Paperclip,
  FileText,
  Image as ImageIcon,
  X,
  Trash2,
  ChevronDown,
  ChevronUp,
  Search,
  Database,
  Clock,
  Tag,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchUpdates,
  submitUpdate,
  deleteUpdate,
  type CIBUpdateResponse,
} from "@/lib/api";

// ─── Helper: format relative time ───

function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString();
}

// ─── Accepted file types ───

const ACCEPTED_TYPES = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg";
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Update Card ───

function UpdateCard({
  update,
  onDelete,
}: {
  update: CIBUpdateResponse;
  onDelete: (id: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={cn(
        "bg-white border rounded-lg p-4 transition-all duration-200 hover:shadow-md",
        update.superseded
          ? "border-gray-200 opacity-60"
          : "border-gray-200"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Tag className="h-3.5 w-3.5 text-accent shrink-0" />
            <h3 className="font-semibold text-gray-900 text-sm truncate">
              {update.topic}
            </h3>
            {update.superseded && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0">
                Superseded
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(update.timestamp)} by {update.author}
          </p>
        </div>

        {/* Delete button */}
        <button
          onClick={() => onDelete(update.id)}
          className="shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
          title="Delete update"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content preview */}
      {update.content && (
        <div
          className={cn(
            "text-gray-700 text-sm leading-relaxed",
            !isExpanded && "line-clamp-3"
          )}
        >
          {update.content}
        </div>
      )}

      {/* Show more/less */}
      {update.content && update.content.length > 200 && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-accent text-xs mt-2 hover:underline"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Show more
            </>
          )}
        </button>
      )}

      {/* Files */}
      {update.files && update.files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {update.files.map((file, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 bg-gray-50 px-2.5 py-1.5 rounded text-xs text-gray-600"
            >
              {file.type.startsWith("image/") ||
              ["png", "jpg", "jpeg"].includes(
                file.filename.split(".").pop()?.toLowerCase() || ""
              ) ? (
                <ImageIcon className="h-3 w-3 text-accent" />
              ) : (
                <FileText className="h-3 w-3 text-accent" />
              )}
              <span className="truncate max-w-[150px]">{file.filename}</span>
              <span className="text-gray-400">
                ({formatFileSize(file.size)})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main UpdateContent Component ───

export function UpdateContent() {
  const [topic, setTopic] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [updates, setUpdates] = useState<CIBUpdateResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Load updates on mount ───
  useEffect(() => {
    loadUpdates();
  }, []);

  const loadUpdates = async () => {
    setIsLoading(true);
    try {
      const data = await fetchUpdates();
      setUpdates(data);
    } catch (err) {
      console.error("Failed to load updates:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Auto-resize textarea ───
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  // ─── File handling ───
  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const validFiles = selectedFiles.filter((f) => {
      if (f.size > MAX_SIZE_BYTES) return false;
      return true;
    });
    setFiles((prev) => [...prev, ...validFiles]);
    e.target.value = "";
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ─── Submit update ───
  const handleSubmit = useCallback(async () => {
    if (!topic.trim()) return;
    if (!inputValue.trim() && files.length === 0) return;
    if (isSubmitting) return;

    setIsSubmitting(true);
    setSubmitStatus("idle");
    setErrorMessage("");

    try {
      await submitUpdate(topic.trim(), inputValue.trim(), files);
      setSubmitStatus("success");
      setInputValue("");
      setFiles([]);

      // Reset textarea height
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
      });

      // Reload updates
      await loadUpdates();

      // Reset success status after 3s
      setTimeout(() => setSubmitStatus("idle"), 3000);
    } catch (err) {
      setSubmitStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to save update"
      );
      setTimeout(() => setSubmitStatus("idle"), 5000);
    } finally {
      setIsSubmitting(false);
    }
  }, [topic, inputValue, files, isSubmitting]);

  // ─── Keyboard shortcuts ───
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // ─── Delete update ───
  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteUpdate(id);
      setUpdates((prev) => prev.filter((u) => u.id !== id));
    } catch (err) {
      console.error("Failed to delete update:", err);
    }
  }, []);

  // ─── Filtered updates ───
  const filteredUpdates = updates.filter((update) => {
    if (!searchQuery.trim()) return true;
    const searchText =
      `${update.topic} ${update.content} ${update.author}`.toLowerCase();
    return searchText.includes(searchQuery.toLowerCase());
  });

  // Active (non-superseded) updates for stats
  const activeUpdates = updates.filter((u) => !u.superseded);
  const uniqueTopics = new Set(activeUpdates.map((u) => u.topic.toLowerCase()))
    .size;

  const hasContent = inputValue.trim().length > 0 || files.length > 0;
  const canSubmit = topic.trim().length > 0 && hasContent && !isSubmitting;

  return (
    <div className="flex-1 flex flex-col bg-surface min-h-0">
      {/* Header bar */}
      <div className="border-b border-gray-200 bg-white px-6 py-3 shrink-0 shadow-sm animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center">
            <Edit3 className="h-4.5 w-4.5 text-accent" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900 leading-tight">
              Update Neumm Knowledge Base
            </h2>
            <p className="text-xs text-gray-500">
              Provide context and updates that Neumm will use to answer questions
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 min-h-0 custom-scrollbar">
        {/* Stats banner */}
        {updates.length > 0 && (
          <div className="bg-accent/5 border border-accent/20 rounded-lg p-4 mb-6 animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Database className="h-5 w-5 text-accent" />
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">
                    Knowledge Base Stats
                  </h3>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {activeUpdates.length} active update
                    {activeUpdates.length !== 1 ? "s" : ""} across{" "}
                    {uniqueTopics} topic{uniqueTopics !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              {updates.length > 0 && (
                <div className="text-right">
                  <p className="text-xs text-gray-500">Last update</p>
                  <p className="text-sm font-medium text-gray-900">
                    {formatRelativeTime(updates[0].timestamp)}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Topic input */}
        <div className="mb-6 max-w-2xl">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            What is this input related to?
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder='e.g., "PlateOS payments feature", "December planning meeting", "Q1 roadmap"'
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm
                       focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all
                       placeholder-gray-400"
          />
          <p className="text-xs text-gray-500 mt-1.5">
            This helps Neumm categorize and retrieve the right information when
            answering questions. Updates with the same topic will supersede
            older ones.
          </p>
        </div>

        {/* Previous updates section */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Previous Updates
            </h2>

            {/* Search */}
            {updates.length > 3 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search updates..."
                  className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs w-48
                           focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                />
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="text-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Loading updates...</p>
            </div>
          ) : filteredUpdates.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Edit3 className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="text-sm">
                {searchQuery
                  ? "No updates match your search."
                  : "No updates yet. Add your first update below."}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-w-2xl">
              {filteredUpdates.map((update) => (
                <UpdateCard
                  key={update.id}
                  update={update}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Input area (fixed at bottom) */}
      <div className="px-4 sm:px-6 pb-4 pt-2 shrink-0">
        <div
          className={cn(
            "bg-white border rounded-xl transition-all duration-200 shadow-card max-w-2xl",
            !topic.trim()
              ? "border-gray-200 opacity-70"
              : "border-gray-200 focus-within:border-accent focus-within:shadow-[0_0_0_2px_rgba(74,144,226,0.15)]"
          )}
        >
          {/* Success / error banner */}
          {submitStatus === "success" && (
            <div className="px-5 pt-3 pb-1 animate-fade-in">
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-lg text-xs">
                <Check className="h-3.5 w-3.5" />
                <span>Update saved successfully!</span>
              </div>
            </div>
          )}
          {submitStatus === "error" && (
            <div className="px-5 pt-3 pb-1 animate-fade-in">
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 px-3 py-2 rounded-lg text-xs">
                <AlertCircle className="h-3.5 w-3.5" />
                <span>{errorMessage || "Failed to save update"}</span>
              </div>
            </div>
          )}

          {/* File attachments preview */}
          {files.length > 0 && (
            <div className="px-5 pt-3 pb-1 flex flex-wrap gap-2">
              {files.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg text-xs border border-gray-200"
                >
                  {file.type.startsWith("image/") ? (
                    <ImageIcon className="h-3.5 w-3.5 text-accent" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-accent" />
                  )}
                  <span className="text-gray-700 truncate max-w-[120px]">
                    {file.name}
                  </span>
                  <span className="text-gray-400">
                    ({formatFileSize(file.size)})
                  </span>
                  <button
                    onClick={() => removeFile(idx)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Main input row */}
          <div className="flex items-end gap-3 px-5 py-4">
            {/* Paperclip */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!topic.trim() || isSubmitting}
              aria-label="Attach file"
              className={cn(
                "shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-all duration-200 mb-px",
                !topic.trim() || isSubmitting
                  ? "text-gray-300 cursor-not-allowed"
                  : "text-gray-400 hover:text-accent hover:bg-accent/5"
              )}
              title="Attach file (PDF, DOCX, TXT, MD, PNG, JPG)"
            >
              <Paperclip className="h-5 w-5" />
            </button>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                adjustHeight();
              }}
              onKeyDown={handleKeyDown}
              disabled={!topic.trim() || isSubmitting}
              placeholder={
                !topic.trim()
                  ? "Specify what this input relates to first..."
                  : "Type your update, paste meeting notes, or upload documents..."
              }
              rows={2}
              className={cn(
                "flex-1 text-[15px] outline-none bg-transparent text-gray-900 placeholder-gray-400 resize-none leading-relaxed py-0.5",
                (!topic.trim() || isSubmitting) && "opacity-50 cursor-not-allowed"
              )}
            />

            {/* Send button */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              aria-label="Submit update"
              title={
                !topic.trim()
                  ? "Specify a topic first"
                  : !hasContent
                  ? "Type your update or attach files"
                  : "Submit update"
              }
              className={cn(
                "shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-all duration-200",
                isSubmitting
                  ? "bg-accent/50 text-white cursor-wait"
                  : canSubmit
                  ? "bg-accent hover:bg-accent-hover active:scale-90 text-white cursor-pointer shadow-sm"
                  : "bg-gray-100 text-gray-300 cursor-not-allowed"
              )}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Helper text */}
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
            <span className="text-[10px] text-gray-300 font-medium tracking-wide">
              Neumm
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
