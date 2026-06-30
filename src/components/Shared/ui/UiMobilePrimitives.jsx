"use client";

// Shared mobile-first primitives reused across page upgrades:
//   UiBottomSheet   — slide-up sheet (filters, pickers, detail panels on mobile)
//   UiStickySaveBar — appears when a form is dirty; sticks above the bottom nav
//   UiOverflowMenu  — "…" menu that collapses multi-button action rows
// All token-driven (no hardcoded hex); styles in ui-mobile-primitives.css.

import React, { useEffect, useRef, useState } from "react";
import { X, MoreHorizontal } from "lucide-react";

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export function UiBottomSheet({ open, onClose, title, children, footer, className }) {
  const sheetRef = useRef(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => sheetRef.current?.focus?.({ preventScroll: true }));
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(frame);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className={cx("ui-sheet", className)}
        role="dialog"
        aria-modal="true"
        aria-label={title || "Sheet"}
        tabIndex={-1}
        ref={sheetRef}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="ui-sheet-handle" aria-hidden="true" />
        {title ? (
          <header className="ui-sheet-head">
            <h2 className="ui-sheet-title">{title}</h2>
            <button type="button" className="ui-sheet-close" onClick={onClose} aria-label="Close">
              <X size={18} aria-hidden="true" />
            </button>
          </header>
        ) : null}
        <div className="ui-sheet-body">{children}</div>
        {footer ? <footer className="ui-sheet-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function UiStickySaveBar({
  visible,
  onSave,
  onDiscard,
  saving = false,
  saveLabel = "Save changes",
  discardLabel = "Discard",
  message = "You have unsaved changes",
}) {
  if (!visible) return null;
  return (
    <div className="ui-save-bar" role="region" aria-label="Unsaved changes">
      <span className="ui-save-bar-msg">{message}</span>
      <div className="ui-save-bar-actions">
        {onDiscard ? (
          <button type="button" className="ui-button ui-button-subtle ui-button-sm" onClick={onDiscard} disabled={saving}>
            {discardLabel}
          </button>
        ) : null}
        <button type="button" className="ui-button ui-button-primary ui-button-sm" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : saveLabel}
        </button>
      </div>
    </div>
  );
}

export function UiOverflowMenu({ items = [], label = "More actions", align = "end" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const onDocClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div className={cx("ui-overflow", align === "end" && "ui-overflow-end")} ref={ref}>
      <button
        type="button"
        className="ui-overflow-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div className="ui-overflow-menu" role="menu">
          {items.map((item, index) => (
            <button
              key={item.key || index}
              type="button"
              role="menuitem"
              className={cx("ui-overflow-item", item.danger && "is-danger")}
              onClick={() => {
                setOpen(false);
                item.onSelect?.();
              }}
              disabled={item.disabled}
            >
              {item.icon ? <span className="ui-overflow-icon">{item.icon}</span> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
