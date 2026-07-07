"use client";

import { useRef } from "react";
import styles from "./Dropdown.module.css";
import { useOutsideDismiss } from "./useOutsideDismiss";

/**
 * Anchored popover — notifications bell, avatar menu, account picker, etc.
 * Fully controlled: the consumer owns `open` state and toggles it from
 * `trigger`'s own onClick, matching the mockups' toggleNotif/toggleAvatarMenu
 * pattern. This component only handles outside-click / Escape to close and
 * positions the panel.
 */
export function Dropdown({ open, onClose, trigger, align = "right", width, children, className = "" }) {
  const wrapRef = useRef(null);
  useOutsideDismiss({ active: open, onDismiss: onClose, refs: [wrapRef] });

  return (
    <div ref={wrapRef} className={styles.wrap}>
      {trigger}
      {open ? (
        <div
          className={[styles.panel, align === "left" ? styles.alignLeft : styles.alignRight, className]
            .filter(Boolean)
            .join(" ")}
          style={width ? { width } : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
