"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
 * Single-slot toast: one message at a time, bottom center, auto-dismiss, and a
 * new call replaces the current toast.
 *
 * ── Why it grew an action ───────────────────────────────────────────────────
 * Undo is cheaper than a dialog for anything reversible, and a confirm dialog
 * in front of a reversible action trains people to click through confirms —
 * which is exactly what you do not want them doing in front of the one that
 * removes files. So reversible actions get an undo toast and destructive,
 * permanent ones keep the modal.
 *
 * That only works if the toast can carry the undo. `show(message, tone)` is
 * unchanged for every existing caller; the options form adds `action` and a
 * per-call `duration`, because an undo window has to be long enough to notice
 * and act on — seconds, not the 2.6s a plain acknowledgement gets.
 */
export function UiV2ToastProvider({ children, duration = 2600 }) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  const themeCtx = useUiV2ThemeOptional();

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const show = useCallback(
    (message, toneOrOptions = "success") => {
      const options = typeof toneOrOptions === "string" ? { tone: toneOrOptions } : toneOrOptions || {};
      const { tone = "success", action = null, duration: overrideDuration, onExpire } = options;

      clearTimeout(timerRef.current);

      const id = Symbol("toast");
      setToast({ id, message, tone, action, onExpire });

      timerRef.current = setTimeout(() => {
        setToast((current) => {
          // Only fire for the toast that actually timed out. A replacement
          // toast must not inherit the previous one's expiry callback — that
          // would commit a delete the user is no longer looking at.
          if (current?.id !== id) return current;
          current.onExpire?.();
          return null;
        });
      }, overrideDuration ?? duration);

      return dismiss;
    },
    [duration, dismiss],
  );

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  // A pending expiry callback must still run if the tree unmounts — otherwise
  // navigating away during an undo window silently cancels the action the user
  // already committed to.
  const toastRef = useRef(null);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      toastRef.current?.onExpire?.();
    },
    [],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && typeof document !== "undefined"
        ? createPortal(
            <div
              data-uiv2-theme={themeCtx?.theme || "dark"}
              className={styles.toast}
              role="status"
              aria-live="polite"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke={ICON_COLOR[toast.tone] || ICON_COLOR.success}
                strokeWidth="2.4"
                aria-hidden="true"
              >
                <path d="M5 12l5 5 9-11" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className={styles.message}>{toast.message}</span>
              {toast.action ? (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    clearTimeout(timerRef.current);
                    setToast(null);
                    toast.action.onClick?.();
                  }}
                >
                  {toast.action.label}
                </button>
              ) : null}
            </div>,
            document.body,
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
