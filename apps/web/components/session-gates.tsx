"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { safeNextPath } from "@/lib/form-errors";
import { useSessionStore } from "@/lib/session-store";
import { FullPageSpinner } from "./full-page-spinner";

/** Shows its children only to signed-in users; sends everyone else to log in. */
export function RequireSession({ children }: { children: ReactNode }) {
  const status = useSessionStore((state) => state.status);
  const signedOutReason = useSessionStore((state) => state.signedOutReason);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== "anonymous") return;
    // After an expired session, come back to this page once logged in again.
    // After choosing to log out, start fresh.
    router.replace(
      signedOutReason === "logout" ? "/login" : `/login?next=${encodeURIComponent(pathname)}`,
    );
  }, [status, signedOutReason, pathname, router]);

  if (status !== "authenticated") return <FullPageSpinner />;
  return children;
}

/** Shows its children only to signed-out users; sends signed-in users on into the app. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const status = useSessionStore((state) => state.status);
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  if (status !== "anonymous") return <FullPageSpinner />;
  return children;
}
