"use client";

import React, { Suspense, useEffect } from "react";
import dynamic from "next/dynamic";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { ThemeProvider } from "../Context/ThemeContext";
import { AuthProvider, useAuth } from "../Context/AuthContext";
import { LogoutProvider } from "../Context/LogoutContext";
import { useAppNavigation } from "../Context/AppNavigationContext";
import AuthLoadingOverlay from "../components/Shared/AuthLoadingOverlay";
import { queryClient, queryPersister } from "../services/queryClient";
import NextNavigationProvider from "./NextNavigationProvider";

const MockPublishModal = dynamic(() => import("../components/Publishing/MockPublishModal"), {
  ssr: false,
});

function NextAppAccessGate({ children }) {
  const { user, loading } = useAuth();
  const { navigate, location } = useAppNavigation();
  const [hasMounted, setHasMounted] = React.useState(false);
  const redirectRef = React.useRef(null);
  const pathname = location?.pathname || "/";
  const search = location?.search || "";
  const hash = location?.hash || "";

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (user) {
      redirectRef.current = null;
    }
  }, [user]);

  useEffect(() => {
    if (loading || user === undefined || user) return;

    const intended = `${pathname}${search}${hash}`;
    if (redirectRef.current === intended) return;
    redirectRef.current = intended;

    if (typeof window !== "undefined" && intended && intended !== "/login") {
      window.sessionStorage?.setItem("socialai-redirect-after-login", intended);
    }

    try {
      navigate("/login", { replace: true, state: { from: { pathname, search, hash } } });
    } catch {
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.replace("/login");
      }
    }
  }, [hash, loading, navigate, pathname, search, user]);

  if (!hasMounted || loading || user === undefined) {
    return (
      <AuthLoadingOverlay
        title="Checking your authentication"
        description="Securing your session and loading your workspace access."
      />
    );
  }

  if (!user) {
    return (
      <AuthLoadingOverlay
        title="Redirecting to sign in"
        description="Opening the login page so you can continue."
      />
    );
  }

  // Access resolution (role / memberships / settings) continues in the
  // background — render the page immediately rather than blocking EVERY route
  // behind a full-screen overlay. Pages handle their own data loading states;
  // admin/org routes gate themselves via their own route shells.
  return children;
}

function AppRuntime({ children }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Suspense
          fallback={(
            <AuthLoadingOverlay
              title="Opening your workspace"
              description="Preparing the command center route."
            />
          )}
        >
          <NextNavigationProvider>
            <NextAppAccessGate>
              <LogoutProvider>
                {children}
                <MockPublishModal />
              </LogoutProvider>
            </NextAppAccessGate>
          </NextNavigationProvider>
        </Suspense>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default function NextAppProviders({ children }) {
  const shell = <AppRuntime>{children}</AppRuntime>;

  if (queryPersister) {
    return (
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: queryPersister, maxAge: 1000 * 60 * 60 }}
      >
        {shell}
      </PersistQueryClientProvider>
    );
  }

  return <QueryClientProvider client={queryClient}>{shell}</QueryClientProvider>;
}
