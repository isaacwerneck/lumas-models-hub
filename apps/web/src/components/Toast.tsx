"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion";

type ToastType = "success" | "error" | "info";
type Toast = { id: number; type: ToastType; message: string };

type ToastContextValue = {
  toast: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast deve ser usado dentro de <ToastProvider>.");
  }
  return context;
};

export const ToastProvider = ({ children, duration = 4000 }: { children: ReactNode; duration?: number }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timersRef = useRef(new Set<number>());
  const reduceMotion = useReducedMotion();

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (type: ToastType, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, type, message }]);
      const timer = window.setTimeout(() => {
        timersRef.current.delete(timer);
        dismiss(id);
      }, duration);
      timersRef.current.add(timer);
    },
    [dismiss, duration]
  );

  const success = useCallback((message: string) => toast("success", message), [toast]);
  const error = useCallback((message: string) => toast("error", message), [toast]);
  const info = useCallback((message: string) => toast("info", message), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        <AnimatePresence mode="sync" initial={false}>
          {toasts.map((item) => (
            <motion.div
              key={item.id}
              layout={!reduceMotion}
              className={`toast toast-${item.type}`}
              role={item.type === "error" ? "alert" : "status"}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: motionTokens.distance.toast, scale: motionTokens.scale.subtle }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: motionTokens.distance.toast, scale: motionTokens.scale.subtle }}
              transition={{
                duration: reduceMotion ? motionTokens.duration.instant : motionTokens.duration.fast,
                ease: motionTokens.easing.smooth
              }}
              onClick={() => dismiss(item.id)}
            >
              {item.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};
