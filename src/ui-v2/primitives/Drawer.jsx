"use client";

import { createPortal } from "react-dom";
import styles from "./Drawer.module.css";
import { useOutsideDismiss } from "./useOutsideDismiss";
import { useUiV2ThemeOptional } from "../ThemeProvider";

/** Right-side sliding drawer — asset detail, post detail, video jobs, session history. */
export function Drawer({ open, onClose, title, width, children, className = "" }) {
  const themeCtx = useUiV2ThemeOptional();
  useOutsideDismiss({ active: open, onDismiss: onClose, refs: [] });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div data-uiv2-theme={themeCtx?.theme || "dark"} style={{ display: "contents" }}>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        className={[styles.panel, className].filter(Boolean).join(" ")}
        style={width ? { width } : undefined}
      >
        {title ? (
          <div className={styles.header}>
            <span className={styles.title}>{title}</span>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>,
    document.body
  );
}
