import React from "react";
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
  const { themePreference, hydrated, cycleTheme } = useTheme();
  const renderedPreference = hydrated ? themePreference : "system";
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
    >
      <span className="theme-toggle__icon" aria-hidden="true">
        <Icon size={16} strokeWidth={1.8} />
      </span>
      {showLabel ? <span className="theme-toggle__label">{currentLabel}</span> : null}
    </button>
  );
}
