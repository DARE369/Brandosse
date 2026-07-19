import React, { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../../Context/ThemeContext";
const THEME_LABELS = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const THEME_ORDER = ["system", "light", "dark"];

const THEME_ICONS = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export default function ThemeToggle({ className = "", showLabel = true }) {
  const { themePreference, cycleTheme } = useTheme();
  // Own mount flag rather than ThemeContext's shared `hydrated` — when this
  // component sits behind a Suspense boundary (e.g. the auth-loading
  // fallback on the Login page), its hydration can be deferred until after
  // ThemeProvider's effect has already flipped `hydrated` true elsewhere in
  // the tree, so the first hydration pass here would render the resolved
  // theme against server HTML that still says "system" — a hydration
  // mismatch. A local effect only ever fires after THIS component's own
  // hydration commits, so it stays correct regardless of when that happens.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const renderedPreference = mounted ? themePreference : "system";
  const Icon = THEME_ICONS[renderedPreference] ?? Monitor;
  const currentIndex = THEME_ORDER.indexOf(renderedPreference);
  const nextTheme = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
  const currentLabel = THEME_LABELS[renderedPreference] ?? "System";
  const nextLabel = THEME_LABELS[nextTheme] ?? "System";
  const buttonClassName = ["theme-toggle", className].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={buttonClassName}
      data-theme-preference={renderedPreference}
      onClick={cycleTheme}
      title={`Theme: ${currentLabel}. Click to cycle to ${nextLabel}.`}
      aria-label={`Theme: ${currentLabel}. Click to cycle to ${nextLabel}.`}
      suppressHydrationWarning
    >
      <span className="theme-toggle__icon" aria-hidden="true" suppressHydrationWarning>
        <Icon size={16} strokeWidth={1.8} />
      </span>
      {showLabel ? <span className="theme-toggle__label">{currentLabel}</span> : null}
    </button>
  );
}
