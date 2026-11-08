"use client";

import { useApi } from "@tessel/api-client/react";
import type {
  ChangePasswordRequest,
  LoginRequest,
  ResetPasswordRequest,
  SignupRequest,
  TwoFactorLoginRequest,
  VerifySignupRequest,
} from "@tessel/contracts";
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

/** Signs in, or hands back a challenge token when a second step is needed. */
export function useLogin() {
  const api = useApi();
  const startSession = useStartSession();
  return useMutation({
    mutationFn: (input: LoginRequest) => api.auth.login(input),
    onSuccess: (result) => {
      if ("accessToken" in result) startSession(result);
    },
  });
}

export function useCompleteTwoFactor() {
  const api = useApi();
  const startSession = useStartSession();
  return useMutation({
    mutationFn: (input: TwoFactorLoginRequest) => api.auth.completeTwoFactor(input),
    onSuccess: startSession,
  });
}

/** Sends the signup code; `useVerifySignup` creates the account. */
export function useSignup() {
  const api = useApi();
  return useMutation({ mutationFn: (input: SignupRequest) => api.auth.signup(input) });
}

export function useVerifySignup() {
  const api = useApi();
  const startSession = useStartSession();
  return useMutation({
    mutationFn: (input: VerifySignupRequest) => api.auth.verifySignup(input),
    onSuccess: startSession,
  });
}

export function useResendSignup() {
  const api = useApi();
  return useMutation({ mutationFn: (challengeId: string) => api.auth.resendSignup(challengeId) });
}

export function useForgotPassword() {
  const api = useApi();
  return useMutation({ mutationFn: (email: string) => api.auth.forgotPassword(email) });
}

export function useResetPassword() {
  const api = useApi();
  return useMutation({
    mutationFn: (input: ResetPasswordRequest) => api.auth.resetPassword(input),
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
