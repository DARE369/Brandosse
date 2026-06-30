import React, { createContext, useContext, useMemo } from "react";

const AppNavigationContext = createContext(null);
const EMPTY_LOCATION = {
  pathname: "/",
  search: "",
  hash: "",
  state: {},
};

function browserNavigate(to, options = {}) {
  if (typeof window === "undefined") return;

  if (typeof to === "number") {
    window.history.go(to);
    return;
  }

  const href = String(to || "/");
  if (options?.replace) {
    window.history.replaceState(options?.state ?? null, "", href);
  } else {
    window.history.pushState(options?.state ?? null, "", href);
  }

  const eventState = options?.state ?? null;
  const event = typeof PopStateEvent === "function"
    ? new PopStateEvent("popstate", { state: eventState })
    : new Event("popstate");
  window.dispatchEvent(event);
}

function getBrowserLocation() {
  if (typeof window === "undefined") return EMPTY_LOCATION;

  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state ?? {},
  };
}

function normalizeLocation(location, pathname, search, hash, state) {
  const fallback = getBrowserLocation();
  const locationState = location && Object.prototype.hasOwnProperty.call(location, "state")
    ? location.state ?? {}
    : undefined;

  return {
    pathname: location?.pathname ?? pathname ?? fallback.pathname,
    search: location?.search ?? search ?? fallback.search,
    hash: location?.hash ?? hash ?? fallback.hash,
    state: locationState ?? state ?? fallback.state ?? {},
  };
}

export function AppNavigationProvider({ children, navigate, pathname, search, hash, state, location }) {
  const normalizedLocation = useMemo(
    () => normalizeLocation(location, pathname, search, hash, state),
    [hash, location, pathname, search, state],
  );

  const value = useMemo(
    () => ({
      navigate: navigate ?? browserNavigate,
      pathname: normalizedLocation.pathname,
      search: normalizedLocation.search,
      hash: normalizedLocation.hash,
      state: normalizedLocation.state,
      location: normalizedLocation,
    }),
    [navigate, normalizedLocation],
  );

  return (
    <AppNavigationContext.Provider value={value}>
      {children}
    </AppNavigationContext.Provider>
  );
}

export function useAppNavigation() {
  const fallbackLocation = getBrowserLocation();

  return useContext(AppNavigationContext) ?? {
    navigate: browserNavigate,
    pathname: fallbackLocation.pathname,
    search: fallbackLocation.search,
    hash: fallbackLocation.hash,
    state: fallbackLocation.state,
    location: fallbackLocation,
  };
}
