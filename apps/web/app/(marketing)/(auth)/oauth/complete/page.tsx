"use client";

import { toApiClientError } from "@tessel/api-client";
import { Spinner } from "@tessel/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TwoFactorStep } from "@/components/auth/two-factor-step";
import { FormError } from "@/components/form-error";
import { useExchangeTicket } from "@/hooks/use-auth";

/**
 * Where Google and GitHub sign-ins land. The API puts a one-time ticket in
 * the URL fragment (never sent to a server); this page trades it for a session,
 * and the guest gate then moves on to `?next=`.
 */
export default function OAuthCompletePage() {
  const exchange = useExchangeTicket();
  const router = useRouter();
  const started = useRef(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ticket = new URLSearchParams(window.location.hash.slice(1)).get("ticket");
    // Drop the ticket from the address bar and history straight away. The page
    // to return to stays in the query, where the guest gate reads it.
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    const exchanged = ticket
      ? exchange.mutateAsync(ticket).catch((caught: unknown) => {
          throw new Error(toApiClientError(caught).message);
        })
      : Promise.reject(new Error("This sign-in link is incomplete. Try again."));
    exchanged.then(
      (result) => {
        if ("challengeToken" in result) setChallengeToken(result.challengeToken);
        // Otherwise the session has started, and the guest gate moves on to `next`.
      },
      (caught: Error) => setError(caught.message),
    );
  }, [exchange]);

  if (challengeToken) {
    return (
      <TwoFactorStep challengeToken={challengeToken} onExpired={() => router.replace("/login")} />
    );
  }
  if (error) {
    return (
      <>
        <h1 className="text-[1.65rem] leading-tight font-semibold tracking-tight">
          Sign-in didn&apos;t finish
        </h1>
        <div className="mt-6">
          <FormError message={error} />
        </div>
        <p className="mt-8">
          <Link
            href="/login"
            className="text-accent font-medium underline-offset-4 hover:underline"
          >
            Back to log in
          </Link>
        </p>
      </>
    );
  }
  return <Spinner label="Signing you in" />;
}
