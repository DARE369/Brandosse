"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";
import { useOutsideDismiss } from "./useOutsideDismiss";
import { useUiV2ThemeOptional } from "../ThemeProvider";

const SIZE_CLASS = { sm: styles.sizeSm, md: styles.sizeMd, lg: styles.sizeLg };

/**
 * Centered confirm/edit dialog — matches the schedule/publish/delete-confirm
 * pattern repeated across every mockup (backdrop blur, modalIn animation,
 * click-outside + Escape to close).
 */
export function Modal({ open, onClose, size = "sm", title, description, children, actions, className = "" }) {
  const panelRef = useRef(null);
  const themeCtx = useUiV2ThemeOptional();
  useOutsideDismiss({ active: open, onDismiss: onClose, refs: [] });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-uiv2-theme={themeCtx?.theme || "dark"}
      className={styles.overlay}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={[styles.panel, SIZE_CLASS[size] || styles.sizeSm, className].filter(Boolean).join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? <div className={styles.title}>{title}</div> : null}
        {description ? <div className={styles.desc}>{description}</div> : null}
        {children}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>,
    document.body
  );
}
