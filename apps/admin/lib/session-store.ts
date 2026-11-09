import type { AuthResponse, PublicUser } from "@tessel/contracts";
import { create } from "zustand";

export type SessionStatus = "loading" | "authenticated" | "anonymous";

/** Why the user is signed out: they chose to, or their session ended (or never existed). */
export type SignedOutReason = "logout" | "expired";

interface SessionState {
  status: SessionStatus;
  /** Lives only in memory. The long-lived refresh token is an httpOnly cookie the page can't read. */
  accessToken: string | null;
  user: PublicUser | null;
  signedOutReason: SignedOutReason | null;
  setSession: (auth: AuthResponse) => void;
  clear: (reason?: SignedOutReason) => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  status: "loading",
  accessToken: null,
  user: null,
  signedOutReason: null,
  setSession: (auth) =>
    set({
      status: "authenticated",
      accessToken: auth.accessToken,
      user: auth.user,
      signedOutReason: null,
    }),
  clear: (reason = "expired") =>
    set({ status: "anonymous", accessToken: null, user: null, signedOutReason: reason }),
}));
