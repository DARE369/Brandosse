"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Toast.module.css";
import { useUiV2ThemeOptional } from "../ThemeProvider";

const ToastContext = createContext(null);
const ICON_COLOR = {
  success: "var(--uiv2-success)",
  danger: "var(--uiv2-danger)",
  warning: "var(--uiv2-warning)",
  info: "var(--uiv2-info)",
};

/**
 * Single-slot toast (matches every mockup: one message at a time, bottom
 * center, ~2.6s auto-dismiss, new call replaces the current toast).
 */
export function UiV2ToastProvider({ children, duration = 2600 }) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  const themeCtx = useUiV2ThemeOptional();

  const show = useCallback(
    (message, tone = "success") => {
      clearTimeout(timerRef.current);
      setToast({ message, tone });
      timerRef.current = setTimeout(() => setToast(null), duration);
    },
    [duration]
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && typeof document !== "undefined"
        ? createPortal(
            <div data-uiv2-theme={themeCtx?.theme || "dark"} className={styles.toast}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke={ICON_COLOR[toast.tone] || ICON_COLOR.success}
                strokeWidth="2.4"
              >
                <path d="M5 12l5 5 9-11" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {toast.message}
            </div>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useUiV2Toast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useUiV2Toast must be used within a UiV2ToastProvider");
  }
  return ctx;
}
