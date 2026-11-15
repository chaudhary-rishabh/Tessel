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
          className="border-line bg-surface text-ink hover:bg-paper focus-visible:outline-accent inline-flex h-11 items-center justify-center gap-2.5 rounded-lg border px-4 font-medium focus-visible:outline-2"
        >
          <ProviderIcon provider={provider} />
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

/** The provider's own mark, beside its name. */
function ProviderIcon({ provider }: { provider: IdentityProvider }) {
  if (provider === "github") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current">
        <path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.53.1.72-.23.72-.5v-1.96c-2.92.63-3.54-1.24-3.54-1.24-.48-1.21-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.05.08 1.61 1.08 1.61 1.08.94 1.6 2.46 1.14 3.06.87.09-.68.36-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.19 0-1.15.41-2.08 1.08-2.82-.11-.26-.47-1.33.1-2.78 0 0 .88-.28 2.89 1.08a10 10 0 0 1 5.26 0c2-1.36 2.88-1.08 2.88-1.08.58 1.45.22 2.52.11 2.78.67.74 1.08 1.67 1.08 2.82 0 4.03-2.46 4.92-4.8 5.18.38.33.71.97.71 1.95v2.89c0 .28.19.6.72.5A10.5 10.5 0 0 0 12 1.5Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path
        fill="#4285F4"
        d="M22.5 12.24c0-.78-.07-1.53-.2-2.24H12v4.26h5.9a5.04 5.04 0 0 1-2.2 3.3v2.76h3.55c2.08-1.92 3.25-4.74 3.25-8.08Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.25-2.68l-3.55-2.76c-.98.66-2.24 1.06-3.7 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
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
