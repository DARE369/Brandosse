"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import "./tokens.css";

const STORAGE_KEY = "uiv2-theme";
const UiV2ThemeContext = createContext(null);

function readStoredTheme() {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Isolated theme provider for the v2 design system. Deliberately does not
 * read from or write to the old ThemeContext/theme.css — v2 screens own
 * their own theme state until every screen has migrated.
 */
export function UiV2ThemeProvider({ children, defaultTheme = "dark", className, style, as: As = "div" }) {
  const [theme, setTheme] = useState(() => readStoredTheme() || defaultTheme);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage unavailable (private mode, SSR) — theme still works in-session */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme, isDark: theme === "dark" }), [theme, toggleTheme]);

  return (
    <UiV2ThemeContext.Provider value={value}>
      <As data-uiv2-theme={theme} className={className} style={style}>
        {children}
      </As>
    </UiV2ThemeContext.Provider>
  );
}

export function useUiV2Theme() {
  const ctx = useContext(UiV2ThemeContext);
  if (!ctx) {
    throw new Error("useUiV2Theme must be used within a UiV2ThemeProvider");
  }
  return ctx;
}

/**
 * Non-throwing variant for primitives that portal to document.body (Modal,
 * Drawer, Toast). All --uiv2-* tokens are scoped to [data-uiv2-theme] (see
 * tokens.css), so anything portaled straight to document.body renders
 * outside that scope and every token resolves to nothing. These primitives
 * use this to re-stamp data-uiv2-theme on their own portaled root instead.
 */
export function useUiV2ThemeOptional() {
  return useContext(UiV2ThemeContext);
}
