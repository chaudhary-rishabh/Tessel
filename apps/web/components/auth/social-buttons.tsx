"use client";

import { useApi, useSignInOptions } from "@tessel/api-client/react";
import type { IdentityProvider } from "@tessel/contracts";

const LABELS: Record<IdentityProvider, string> = { google: "Google", github: "GitHub" };

/**
 * "Continue with Google / GitHub", for the providers this deployment has set
 * up. Each is a full-page link: the API redirects to the provider and back.
 */
export function SocialButtons({ next }: { next?: string | undefined }) {
  const api = useApi();
  const options = useSignInOptions();
  const providers = (["google", "github"] as const).filter((provider) => options.data?.[provider]);
  if (providers.length === 0) return null;

  return (
    <div className="mt-8 flex flex-col gap-3">
      {providers.map((provider) => (
        <a
          key={provider}
          href={api.auth.oauthStartUrl(provider, next)}
          className="border-line bg-surface text-ink hover:bg-paper focus-visible:outline-accent inline-flex h-11 items-center justify-center rounded-lg border px-4 font-medium focus-visible:outline-2"
        >
          Continue with {LABELS[provider]}
        </a>
      ))}
      <div className="text-muted flex items-center gap-3 text-sm" aria-hidden="true">
        <span className="bg-line h-px flex-1" />
        or
        <span className="bg-line h-px flex-1" />
      </div>
    </div>
  );
}

/** What went wrong, for the login page's `?error=` after a Google or GitHub sign-in. */
export const SOCIAL_ERRORS: Record<string, string> = {
  oauth_cancelled: "Sign-in was cancelled. Try again, or log in another way.",
  oauth_expired: "That sign-in took too long or was started in another browser. Try again.",
  oauth_failed: "We couldn't reach the sign-in provider. Try again in a moment.",
  email_unverified:
    "That account's email address isn't verified. Verify it with the provider first, or sign up with email.",
  identity_taken: "That account is already linked to a different Tessel account.",
};
