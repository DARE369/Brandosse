"use client";

/**
 * The light/dark switch, defined once.
 *
 * LOCK L5.6. This exact component was pasted into eleven files. AppShell now
 * renders it for every shell page, but the focused flows that deliberately do
 * NOT take the app chrome — the connect-account wizard, which must not offer
 * navigation mid-OAuth — still need the control on its own. So it lives here
 * rather than inside AppShell, and both import it.
 */

import { useUiV2Theme } from "../ThemeProvider";
import { IconButton } from "../primitives/IconButton";

export function ThemeToggleButton() {
  const { isDark, toggleTheme } = useUiV2Theme();
  return (
    <IconButton title={isDark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z" />
        </svg>
      )}
    </IconButton>
  );
}
