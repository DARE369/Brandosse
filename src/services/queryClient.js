import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

export const QUERY_CACHE_KEY = "socialai-query-cache";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 60,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

export const queryPersister =
  typeof window !== "undefined"
    ? createSyncStoragePersister({
        key: QUERY_CACHE_KEY,
        storage: window.sessionStorage,
      })
    : null;
