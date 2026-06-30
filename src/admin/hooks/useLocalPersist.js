import { useEffect, useState } from "react";

export default function useLocalPersist(key, defaultValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return defaultValue;
    const stored = window.localStorage.getItem(key);
    if (stored === null) return defaultValue;

    try {
      return JSON.parse(stored);
    } catch (_error) {
      return stored;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    window.localStorage.setItem(key, serialized);
  }, [key, value]);

  return [value, setValue];
}
