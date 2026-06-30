import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

const ThemeContext = createContext(null);

const THEME_STORAGE_KEY = "app-theme-preference";
const LEGACY_THEME_STORAGE_KEY = "socialai-theme";
const THEME_PREFERENCES = ["system", "light", "dark"];

function getSystemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : "system";
}

function readStoredThemePreference() {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const savedPreference = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedPreference) {
      return normalizeThemePreference(savedPreference);
    }

    const legacyPreference = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacyPreference === "light" || legacyPreference === "dark") {
      return legacyPreference;
    }
  } catch {
    return "system";
  }

  return "system";
}

function resolveTheme(preference, systemTheme) {
  return preference === "system" ? systemTheme : preference;
}

function applyThemeToDocument(preference, systemTheme = getSystemTheme()) {
  if (typeof document === "undefined") {
    return resolveTheme(preference, systemTheme);
  }

  const resolvedTheme = resolveTheme(preference, systemTheme);
  const root = document.documentElement;

  root.setAttribute("data-theme", resolvedTheme);
  root.setAttribute("data-theme-preference", preference);
  root.style.colorScheme = resolvedTheme;
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.classList.toggle("light", resolvedTheme === "light");

  return resolvedTheme;
}

export function ThemeProvider({ children }) {
  const [themePreference, setThemePreference] = useState("system");
  const [systemTheme, setSystemTheme] = useState("light");
  const [hydrated, setHydrated] = useState(false);

  const theme = resolveTheme(themePreference, systemTheme);

  useLayoutEffect(() => {
    const storedPreference = readStoredThemePreference();
    const currentSystemTheme = getSystemTheme();

    setThemePreference(storedPreference);
    setSystemTheme(currentSystemTheme);
    setHydrated(true);
    applyThemeToDocument(storedPreference, currentSystemTheme);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, storedPreference);
      localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } catch {
      // Ignore storage failures and keep the in-memory preference.
    }
  }, []);

  useLayoutEffect(() => {
    if (!hydrated) return;

    applyThemeToDocument(themePreference, systemTheme);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, themePreference);
      localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } catch {
      // Ignore storage failures and keep the in-memory preference.
    }
  }, [hydrated, themePreference, systemTheme]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    setSystemTheme(mediaQuery.matches ? "dark" : "light");

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    let firstFrame = 0;
    let secondFrame = 0;

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        root.classList.remove("theme-no-transition");
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setThemePreference((currentPreference) => {
      const currentResolvedTheme = resolveTheme(currentPreference, getSystemTheme());
      return currentResolvedTheme === "dark" ? "light" : "dark";
    });
  }, []);

  const cycleTheme = useCallback(() => {
    setThemePreference((currentPreference) => {
      const currentIndex = THEME_PREFERENCES.indexOf(currentPreference);
      const nextIndex = (currentIndex + 1) % THEME_PREFERENCES.length;
      return THEME_PREFERENCES[nextIndex];
    });
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        themePreference,
        resolvedTheme: theme,
        hydrated,
        isDark: theme === "dark",
        setThemePreference,
        toggleTheme,
        cycleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);

  if (!ctx) {
    throw new Error("useTheme must be inside <ThemeProvider>");
  }

  return ctx;
}
