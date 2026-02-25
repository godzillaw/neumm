"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, XCircle, X, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastType = "error" | "warning" | "network";

export interface ToastData {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  autoDismiss?: boolean; // defaults true, 5 seconds
}

interface ToastItemProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (toast.autoDismiss !== false) {
      const timer = setTimeout(() => {
        setIsExiting(true);
        setTimeout(() => onDismiss(toast.id), 300);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.autoDismiss, onDismiss]);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  }, [toast.id, onDismiss]);

  const Icon = toast.type === "network" ? WifiOff : toast.type === "error" ? XCircle : AlertTriangle;

  const bgColor =
    toast.type === "network"
      ? "bg-orange-50 border-orange-200"
      : toast.type === "error"
      ? "bg-red-50 border-red-200"
      : "bg-yellow-50 border-yellow-200";

  const iconColor =
    toast.type === "network"
      ? "text-orange-500"
      : toast.type === "error"
      ? "text-red-500"
      : "text-yellow-600";

  const titleColor =
    toast.type === "network"
      ? "text-orange-800"
      : toast.type === "error"
      ? "text-red-800"
      : "text-yellow-800";

  const messageColor =
    toast.type === "network"
      ? "text-orange-600"
      : toast.type === "error"
      ? "text-red-600"
      : "text-yellow-600";

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg max-w-sm w-full transition-all duration-300",
        bgColor,
        isExiting
          ? "opacity-0 translate-x-4 scale-95"
          : "opacity-100 translate-x-0 scale-100 animate-slide-in-toast"
      )}
    >
      <div className="shrink-0 mt-0.5">
        <Icon className={cn("h-5 w-5", iconColor)} />
      </div>

      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-semibold", titleColor)}>{toast.title}</p>
        <p className={cn("text-xs mt-0.5 leading-relaxed", messageColor)}>
          {toast.message}
        </p>
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            className={cn(
              "mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-all",
              toast.type === "network"
                ? "bg-orange-100 text-orange-700 hover:bg-orange-200"
                : toast.type === "error"
                ? "bg-red-100 text-red-700 hover:bg-red-200"
                : "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
            )}
          >
            {toast.type === "network" ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {toast.action.label}
          </button>
        )}
      </div>

      <button
        onClick={handleDismiss}
        className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-black/5 transition-all"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Toast container ───

interface ErrorToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

export function ErrorToastContainer({
  toasts,
  onDismiss,
}: ErrorToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// ─── Hook for managing toasts ───

export function useToasts() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = useCallback((toast: Omit<ToastData, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  return { toasts, addToast, dismissToast, clearAll };
}
