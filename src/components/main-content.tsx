"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { type Persona } from "@/lib/personas";
import { getQuestionsForPersona } from "@/lib/questions";
import { fetchAnswerStream, ApiError, type ConversationMessage } from "@/lib/api";
import { logError } from "@/lib/error-logger";
import { QuestionCard } from "@/components/question-card";
import { MessageComposer } from "@/components/message-composer";
import { ChatMessage, type ChatMessageData } from "@/components/chat-message";
import { FollowupSuggestions } from "@/components/followup-suggestions";
import { ErrorToastContainer, useToasts } from "@/components/error-toast";
import { ArrowLeft, Sparkles, Trash2 } from "lucide-react";

interface MainContentProps {
  selectedPersona: Persona | null;
}

// ─── Map to track which question triggered which bot message ───
type QuestionMap = Map<string, string>; // botMsgId → original question text

export function MainContent({ selectedPersona }: MainContentProps) {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isStreamingActive, setIsStreamingActive] = useState(false);
  const [followupSuggestions, setFollowupSuggestions] = useState<Record<string, string[]>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevPersonaRef = useRef<string | null>(null);
  const questionMapRef = useRef<QuestionMap>(new Map());
  const conversationHistoryRef = useRef<ConversationMessage[]>([]);
  const { toasts, addToast, dismissToast } = useToasts();

  // Reset messages when persona changes
  useEffect(() => {
    if (selectedPersona?.id !== prevPersonaRef.current) {
      setMessages([]);
      setFollowupSuggestions({});
      questionMapRef.current = new Map();
      conversationHistoryRef.current = [];
      prevPersonaRef.current = selectedPersona?.id ?? null;
    }
  }, [selectedPersona]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  const formatTime = useCallback(() => {
    return new Date().toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }, []);

  // ─── Clear conversation ───
  const handleClearConversation = useCallback(() => {
    setMessages([]);
    setFollowupSuggestions({});
    questionMapRef.current = new Map();
    conversationHistoryRef.current = [];
  }, []);

  // ─── Shared handler: ask a question via streaming API ───
  const handleAskQuestionRef = useRef<(text: string) => Promise<void>>();

  const handleAskQuestion = useCallback(
    async (text: string) => {
      if (!selectedPersona) return;

      const userMsg: ChatMessageData = {
        id: `user-${Date.now()}`,
        type: "user",
        text,
        timestamp: formatTime(),
      };

      const botId = `bot-${Date.now()}`;
      const botMsg: ChatMessageData = {
        id: botId,
        type: "bot",
        text: "",
        timestamp: formatTime(),
        isLoading: true,
        isStreaming: true,
      };

      // Track which question triggered this bot response
      questionMapRef.current.set(botId, text);

      setMessages((prev) => [...prev, userMsg, botMsg]);
      setIsStreamingActive(true);

      try {
        let firstChunkReceived = false;

        await fetchAnswerStream(
          text,
          selectedPersona.id,
          conversationHistoryRef.current,
          // onChunk
          (chunk: string) => {
            if (!firstChunkReceived) {
              firstChunkReceived = true;
              // Turn off loading dots once first chunk arrives
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId
                    ? { ...m, isLoading: false, text: chunk }
                    : m
                )
              );
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId
                    ? { ...m, text: m.text + chunk }
                    : m
                )
              );
            }
          },
          // onDone
          (confidence: number, sources: string[], followups: string[]) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === botId
                  ? {
                      ...m,
                      isLoading: false,
                      isStreaming: false,
                      confidence,
                      sources,
                      answeredAt: Date.now(),
                    }
                  : m
              )
            );

            // Store follow-up suggestions
            if (followups.length > 0) {
              setFollowupSuggestions((prev) => ({ ...prev, [botId]: followups }));
            }

            // Update conversation history (keep last 10 messages)
            // We need the final bot text — read it from state
            setMessages((prev) => {
              const botMessage = prev.find((m) => m.id === botId);
              const userEntry: ConversationMessage = { role: "user", content: text };
              if (botMessage && !botMessage.isError) {
                const assistantEntry: ConversationMessage = { role: "assistant", content: botMessage.text };
                conversationHistoryRef.current = [
                  ...conversationHistoryRef.current,
                  userEntry,
                  assistantEntry,
                ].slice(-10);
              } else {
                conversationHistoryRef.current = [
                  ...conversationHistoryRef.current,
                  userEntry,
                ].slice(-10);
              }
              return prev;
            });

            setIsStreamingActive(false);
          }
        );
      } catch (error) {
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError("UNKNOWN", "Something unexpected went wrong. Please try again.");

        logError(
          apiError.code === "NETWORK_ERROR"
            ? "NETWORK"
            : apiError.code === "TIMEOUT"
            ? "TIMEOUT"
            : apiError.code === "INVALID_KEY"
            ? "API_KEY"
            : "UNKNOWN",
          apiError.userMessage,
          { question: text, persona: selectedPersona.id }
        );

        // Update bot message with error state
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId
              ? {
                  ...m,
                  isLoading: false,
                  isStreaming: false,
                  text: apiError.userMessage,
                  isError: true,
                  errorCode: apiError.code,
                  answeredAt: Date.now(),
                }
              : m
          )
        );

        setIsStreamingActive(false);

        // Show toast for network errors
        if (apiError.code === "NETWORK_ERROR") {
          addToast({
            type: "network",
            title: "Connection Lost",
            message: "Check your internet connection and try again.",
            action: {
              label: "Retry",
              onClick: () => handleAskQuestionRef.current?.(text),
            },
            autoDismiss: false,
          });
        }
      }
    },
    [selectedPersona, formatTime, addToast]
  );

  // Keep ref in sync
  handleAskQuestionRef.current = handleAskQuestion;

  // ─── Retry handler for failed messages ───
  const handleRetry = useCallback(
    (question: string) => {
      if (!selectedPersona) return;
      handleAskQuestion(question);
    },
    [selectedPersona, handleAskQuestion]
  );

  // ─── Compute last user message for Up-arrow editing ───
  const lastUserMessage = useMemo(() => {
    const userMessages = messages.filter((m) => m.type === "user");
    return userMessages[userMessages.length - 1]?.text;
  }, [messages]);

  // ─── Empty state ───
  if (!selectedPersona) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center max-w-md px-4 animate-fade-in-up">
          <div className="relative inline-block mb-6">
            <div className="h-20 w-20 rounded-2xl flex items-center justify-center mx-auto animate-float">
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ borderRadius: 18 }}>
                <defs>
                  <linearGradient id="ng-mc" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#4DD9C0"/>
                    <stop offset="100%" stopColor="#3A7BD5"/>
                  </linearGradient>
                </defs>
                <rect width="80" height="80" rx="18" fill="url(#ng-mc)"/>
                <path d="M18 62V18h9L58 53V18H64v44H55L27 27V62H18z" fill="white"/>
              </svg>
            </div>
            <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-accent/10 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            Neumm
          </h2>
          <p className="text-gray-500 mb-8 leading-relaxed">
            Your AI-powered company knowledge assistant.
            Select a persona to get started.
          </p>

          <div className="flex items-center justify-center gap-2 text-accent">
            <ArrowLeft className="h-5 w-5 animate-arrow-bounce" />
            <span className="text-sm font-medium">
              Choose a persona from the sidebar
            </span>
          </div>
        </div>
      </div>
    );
  }

  const Icon = selectedPersona.icon;
  const questions = getQuestionsForPersona(selectedPersona.id);

  return (
    <div className="flex-1 flex flex-col bg-surface min-h-0">
      {/* Toast notifications */}
      <ErrorToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Persona header bar */}
      <div className="border-b border-gray-200 bg-white px-6 py-3 shrink-0 shadow-sm animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-sidebar/10 flex items-center justify-center">
            <Icon className="h-4.5 w-4.5 text-sidebar" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900 leading-tight">
              {selectedPersona.name}
            </h2>
            <p className="text-xs text-gray-500">
              {selectedPersona.description}
            </p>
          </div>

          {/* Clear conversation button */}
          {messages.length > 0 && (
            <button
              onClick={handleClearConversation}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all duration-150"
              title="Clear conversation"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 min-h-0 custom-scrollbar"
      >
        {/* Welcome message */}
        <div className="flex gap-3 mb-6 animate-fade-in">
          <div className="h-9 w-9 rounded-lg bg-sidebar flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-gray-900 text-sm">
                {selectedPersona.name} Bot
              </span>
              <span className="text-[11px] text-gray-400">Just now</span>
            </div>
            <p className="mt-1 text-sm text-gray-700 leading-relaxed">
              Welcome to <strong>{selectedPersona.name}</strong>! Here are
              your key questions. Click any card to get an answer, or type your
              own below.
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest shrink-0">
            Suggested questions
          </span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Question cards */}
        <div className="flex flex-col gap-3 max-w-2xl">
          {questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              question={question}
              index={index}
              onAsk={handleAskQuestion}
            />
          ))}
        </div>

        {/* Chat messages */}
        {messages.length > 0 && (
          <>
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest shrink-0">
                Conversation
              </span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <div className="flex flex-col gap-1 max-w-2xl">
              {messages.map((msg) => (
                <div key={msg.id}>
                  <ChatMessage
                    message={msg}
                    personaName={selectedPersona.name}
                    personaIcon={selectedPersona.icon}
                    onRetry={handleRetry}
                    originalQuestion={
                      msg.type === "bot"
                        ? questionMapRef.current.get(msg.id)
                        : undefined
                    }
                  />
                  {/* Follow-up suggestions after completed bot messages */}
                  {msg.type === "bot" &&
                    !msg.isLoading &&
                    !msg.isStreaming &&
                    !msg.isError &&
                    followupSuggestions[msg.id] && (
                      <FollowupSuggestions
                        suggestions={followupSuggestions[msg.id]}
                        onAsk={handleAskQuestion}
                      />
                    )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Message composer */}
      <MessageComposer
        personaName={selectedPersona.name}
        personaId={selectedPersona.id}
        onSend={handleAskQuestion}
        isLoading={isStreamingActive}
        lastUserMessage={lastUserMessage}
      />
    </div>
  );
}
