"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppNavigationProvider } from "../Context/AppNavigationContext";

const NAVIGATION_STATE_PREFIX = "socialai:navigation-state:";

function makeStateKey(pathname, search = "", hash = "") {
  return `${pathname || "/"}${search || ""}${hash || ""}`;
}

function parseHref(href) {
  if (typeof window === "undefined") {
    return { pathname: String(href || "/"), search: "", hash: "" };
  }

  const url = new URL(String(href || "/"), window.location.origin);
  return {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
}

function readStoredState(pathname, search, hash) {
  if (typeof window === "undefined" || !window.sessionStorage) return {};

  const key = `${NAVIGATION_STATE_PREFIX}${makeStateKey(pathname, search, hash)}`;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStoredState(pathname, search, hash, state) {
  if (typeof window === "undefined" || !window.sessionStorage) return;

  const key = `${NAVIGATION_STATE_PREFIX}${makeStateKey(pathname, search, hash)}`;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(state ?? {}));
  } catch {
    // Storage can fail in restricted browser modes; navigation should still proceed.
  }
}

export default function NextNavigationProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = useMemo(() => {
    const value = searchParams?.toString();
    return value ? `?${value}` : "";
  }, [searchParams]);
  const [hash, setHash] = useState("");
  const [routeState, setRouteState] = useState({});

  const syncBrowserLocation = useCallback(() => {
    if (typeof window === "undefined") return;
    const nextHash = window.location.hash;
    const nextSearch = window.location.search;
    const nextPathname = window.location.pathname;
    setHash(nextHash);
    setRouteState(readStoredState(nextPathname, nextSearch, nextHash));
  }, []);

  useEffect(() => {
    syncBrowserLocation();
  }, [pathname, search, syncBrowserLocation]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    window.addEventListener("hashchange", syncBrowserLocation);
    window.addEventListener("popstate", syncBrowserLocation);
    return () => {
      window.removeEventListener("hashchange", syncBrowserLocation);
      window.removeEventListener("popstate", syncBrowserLocation);
    };
  }, [syncBrowserLocation]);

  const navigate = useCallback(
    (to, options = {}) => {
      if (typeof to === "number") {
        window.history.go(to);
        return;
      }

      const href = String(to || "/");
      const target = parseHref(href);
      if (Object.prototype.hasOwnProperty.call(options, "state")) {
        writeStoredState(target.pathname, target.search, target.hash, options.state);
        setRouteState(options.state ?? {});
      }
      setHash(target.hash);

      if (options?.replace) {
        router.replace(href);
      } else {
        router.push(href);
      }
    },
    [router],
  );

  const location = useMemo(
    () => ({
      pathname,
      search,
      hash,
      state: routeState,
    }),
    [hash, pathname, routeState, search],
  );

  return (
    <AppNavigationProvider
      navigate={navigate}
      location={location}
    >
      {children}
    </AppNavigationProvider>
  );
}
