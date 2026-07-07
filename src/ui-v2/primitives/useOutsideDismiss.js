"use client";

import { useEffect } from "react";

/**
 * Shared dismiss behavior for modals/drawers/dropdowns: Escape key always
 * closes; outside click closes unless `refs` is omitted (e.g. always-mounted
 * overlays that close via their own backdrop onClick instead).
 */
export function useOutsideDismiss({ active, onDismiss, refs = [] }) {
  useEffect(() => {
    if (!active) return undefined;

    const handleKey = (e) => {
      if (e.key === "Escape") onDismiss();
    };
    const handleClick = (e) => {
      if (refs.length === 0) return;
      const inside = refs.some((r) => r.current && r.current.contains(e.target));
      if (!inside) onDismiss();
    };

    window.addEventListener("keydown", handleKey);
    if (refs.length > 0) window.addEventListener("mousedown", handleClick, true);
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (refs.length > 0) window.removeEventListener("mousedown", handleClick, true);
    };
  }, [active, onDismiss, refs]);
}
