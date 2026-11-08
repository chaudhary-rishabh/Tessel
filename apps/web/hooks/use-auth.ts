"use client";

import { useApi } from "@tessel/api-client/react";
import type { ChangePasswordRequest, LoginRequest, SignupRequest } from "@tessel/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSessionStore } from "@/lib/session-store";

/** Starting a new session clears cached data from any previous user. */
function useStartSession() {
  const queryClient = useQueryClient();
  const setSession = useSessionStore((state) => state.setSession);
  return (auth: Parameters<typeof setSession>[0]) => {
    queryClient.clear();
    setSession(auth);
  };
}

export function useLogin() {
  const api = useApi();
  const startSession = useStartSession();
  return useMutation({
    mutationFn: (input: LoginRequest) => api.auth.login(input),
    onSuccess: startSession,
  });
}

export function useSignup() {
  const api = useApi();
  const startSession = useStartSession();
  return useMutation({
    mutationFn: (input: SignupRequest) => api.auth.signup(input),
    onSuccess: startSession,
  });
}

export function useLogout() {
  const api = useApi();
  const queryClient = useQueryClient();
  const clear = useSessionStore((state) => state.clear);
  return useMutation({
    mutationFn: () => api.auth.logout(),
    // Log out locally even if the request fails, so the user is never stuck.
    // RequireSession then sends the user to the login page.
    onSettled: () => {
      clear("logout");
      queryClient.clear();
    },
  });
}

export function useChangePassword() {
  const api = useApi();
  const setSession = useSessionStore((state) => state.setSession);
  return useMutation({
    mutationFn: (input: ChangePasswordRequest) => api.users.changePassword(input),
    onSuccess: setSession,
  });
}
