"use client";

import React, { Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { ThemeProvider } from "../Context/ThemeContext";
import { AuthProvider } from "../Context/AuthContext";
import { LogoutProvider } from "../Context/LogoutContext";
import AuthLoadingOverlay from "../components/Shared/AuthLoadingOverlay";
import { queryClient, queryPersister } from "../services/queryClient";
import NextNavigationProvider from "./NextNavigationProvider";

function PublicRuntime({ children }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Suspense
          fallback={(
            <AuthLoadingOverlay
              title="Opening Brandosse"
              description="Preparing the route."
            />
          )}
        >
          <NextNavigationProvider>
            <LogoutProvider>{children}</LogoutProvider>
          </NextNavigationProvider>
        </Suspense>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default function NextPublicProviders({ children }) {
  const shell = <PublicRuntime>{children}</PublicRuntime>;

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
