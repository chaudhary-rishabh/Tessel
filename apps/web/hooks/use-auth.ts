"use client";

import { queryKeys, useApi } from "@tessel/api-client/react";
import type {
  LoginResponse,
  PhoneVerifyRequest,
  ChangePasswordRequest,
  LoginRequest,
  ResetPasswordRequest,
  SignupRequest,
  TwoFactorLoginRequest,
  UpdateProfileRequest,
} from "@tessel/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resetChatSession } from "@/lib/chat-store";
import { useSessionStore } from "@/lib/session-store";

/** Starting a new session clears cached data from any previous user. */
function useStartSession() {
  const queryClient = useQueryClient();
  const setSession = useSessionStore((state) => state.setSession);
  return (auth: Parameters<typeof setSession>[0]) => {
    resetChatSession();
    queryClient.clear();
    setSession(auth);
  };
}

/** Starts the session when a sign-in step finishes it; a two-step challenge is left to the caller. */
function useFinishSignIn() {
  const startSession = useStartSession();
  return (result: LoginResponse) => {
    if ("accessToken" in result) startSession(result);
  };
}

/** Trades the ticket from a Google or GitHub sign-in for a session. */
export function useExchangeTicket() {
  const api = useApi();
  const finish = useFinishSignIn();
  return useMutation({
    mutationFn: (ticket: string) => api.auth.exchangeTicket(ticket),
    onSuccess: finish,
  });
}

export function useStartPhoneSignIn() {
  const api = useApi();
  return useMutation({ mutationFn: (phone: string) => api.auth.startPhoneSignIn(phone) });
}

export function useVerifyPhoneSignIn() {
  const api = useApi();
  const finish = useFinishSignIn();
  return useMutation({
    mutationFn: (input: PhoneVerifyRequest) => api.auth.verifyPhoneSignIn(input),
    onSuccess: finish,
  });
}

/** Signs in, or hands back a challenge token when a second step is needed. */
export function useLogin() {
  const api = useApi();
  const finish = useFinishSignIn();
  return useMutation({
    mutationFn: (input: LoginRequest) => api.auth.login(input),
    onSuccess: finish,
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

/** Creates the account and signs straight in; a link to confirm the email follows by email. */
export function useSignup() {
  const api = useApi();
  const startSession = useStartSession();
  return useMutation({
    mutationFn: (input: SignupRequest) => api.auth.signup(input),
    onSuccess: startSession,
  });
}

/** Keeps the signed-in user's details current everywhere after a change. */
function useSetUser() {
  const queryClient = useQueryClient();
  const setUser = useSessionStore((state) => state.setUser);
  return (user: Parameters<typeof setUser>[0]) => {
    setUser(user);
    queryClient.setQueryData(queryKeys.me, user);
  };
}

/** Confirms the signed-in user's email with the token from the emailed link. */
export function useVerifyEmail() {
  const api = useApi();
  const setUser = useSetUser();
  return useMutation({
    mutationFn: (token: string) => api.users.verifyEmail(token),
    onSuccess: setUser,
  });
}

export function useResendEmailVerification() {
  const api = useApi();
  return useMutation({ mutationFn: () => api.users.resendEmailVerification() });
}

export function useUpdateProfile() {
  const api = useApi();
  const setUser = useSetUser();
  return useMutation({
    mutationFn: (input: UpdateProfileRequest) => api.users.updateProfile(input),
    onSuccess: setUser,
  });
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
      resetChatSession();
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
