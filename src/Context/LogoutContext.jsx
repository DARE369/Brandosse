import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthContext";
import { useAppNavigation } from "./AppNavigationContext";

const QUERY_CACHE_KEY = "socialai-query-cache";
const LogoutContext = createContext(null);

function LogoutToast({ countdown, onCancel }) {
  return (
    <div className="logout-toast" role="status" aria-live="polite">
      <span className="logout-toast__icon" aria-hidden="true">
        🔒
      </span>
      <span className="logout-toast__text">Logging out in {countdown}s...</span>
      <button type="button" className="logout-toast__cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export function LogoutProvider({ children }) {
  const { navigate } = useAppNavigation();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const executingRef = useRef(false);

  const cancelLogout = useCallback(() => {
    if (executingRef.current) return;
    setLoggingOut(false);
    setCountdown(3);
  }, []);

  const executeLogout = useCallback(async () => {
    if (executingRef.current) return;
    executingRef.current = true;

    try {
      queryClient.clear();
      sessionStorage.removeItem(QUERY_CACHE_KEY);

      await logout();
      navigate("/", { replace: true });
    } catch (error) {
      console.error("[LogoutProvider] logout failed:", error);
      setLoggingOut(false);
      setCountdown(3);
    } finally {
      executingRef.current = false;
    }
  }, [logout, navigate, queryClient, user?.id]);

  const initiateLogout = useCallback(() => {
    if (loggingOut || executingRef.current) return;
    setCountdown(3);
    setLoggingOut(true);
  }, [loggingOut]);

  useEffect(() => {
    if (!loggingOut) return undefined;
    if (countdown <= 0) {
      executeLogout();
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCountdown((current) => current - 1);
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [countdown, executeLogout, loggingOut]);

  const value = useMemo(
    () => ({
      cancelLogout,
      countdown,
      initiateLogout,
      loggingOut,
    }),
    [cancelLogout, countdown, initiateLogout, loggingOut],
  );

  return (
    <LogoutContext.Provider value={value}>
      {loggingOut ? <LogoutToast countdown={countdown} onCancel={cancelLogout} /> : null}
      {children}
    </LogoutContext.Provider>
  );
}

export function useLogout() {
  const context = useContext(LogoutContext);

  if (!context) {
    throw new Error("useLogout must be used inside LogoutProvider");
  }

  return context;
}
