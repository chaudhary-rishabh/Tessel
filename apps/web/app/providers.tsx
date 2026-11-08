"use client";

import { ApiClientError } from "@tessel/api-client";
import { ApiProvider } from "@tessel/api-client/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@/components/toaster";
import { getApi } from "@/lib/api";
import { useSessionStore } from "@/lib/session-store";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retry network and server errors, never client errors like 401 or 404.
        retry: (failureCount, error) => {
          if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

/**
 * Restores the session on page load by exchanging the httpOnly refresh cookie
 * for an access token, and clears cached data when the session ends.
 */
function SessionBootstrap() {
  const status = useSessionStore((state) => state.status);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (useSessionStore.getState().status !== "loading") return;
    getApi()
      .auth.refresh()
      .catch(() => useSessionStore.getState().clear());
  }, []);

  useEffect(() => {
    if (status === "anonymous") queryClient.clear();
  }, [status, queryClient]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={getApi()}>
        <SessionBootstrap />
        {children}
        <Toaster />
      </ApiProvider>
    </QueryClientProvider>
  );
}
