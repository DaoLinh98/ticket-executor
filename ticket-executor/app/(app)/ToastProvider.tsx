"use client";

import { AnimatePresence } from "motion/react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import Toast, { type ToastMessage } from "../ticket-executor/Toast";

type ToastKind = ToastMessage["kind"];
type ShowToast = (msg: string, kind?: ToastKind, durationMs?: number, action?: ToastMessage["action"]) => void;

const ToastContext = createContext<ShowToast | null>(null);

export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const seq = useRef(0);

  const showToast = useCallback<ShowToast>((msg, kind = "success", durationMs = 7000, action) => {
    setToast({ id: ++seq.current, msg, kind, durationMs, action });
  }, []);
  const close = useCallback(() => setToast(null), []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <AnimatePresence>{toast && <Toast key={toast.id} toast={toast} onClose={close} />}</AnimatePresence>
    </ToastContext.Provider>
  );
}
