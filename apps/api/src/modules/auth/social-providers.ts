import type { IdentityProvider } from "@tessel/contracts";
import { z } from "zod";

/** What Tessel needs from a Google or GitHub account. */
export interface SocialProfile {
  /** The provider's stable account ID. */
  id: string;
  email: string;
  /** Whether the provider has confirmed the person owns the email. */
  emailVerified: boolean;
  name: string;
}

export interface SocialProvider {
  name: IdentityProvider;
  /** Where to send the browser to sign in. */
  authorizeUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string;
  /** Exchanges the callback's code for the signed-in account. */
  fetchProfile(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<SocialProfile>;
}

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface SocialProvidersOptions {
  google?: OAuthClientCredentials | undefined;
  github?: OAuthClientCredentials | undefined;
  /**
   * Development and tests: send both providers to a mock server instead
   * (`/google/...` and `/github/...` under this URL).
   */
  mockBaseUrl?: string | undefined;
  fetch?: typeof fetch;
}

const TIMEOUT_MS = 10_000;

export class SocialProviderError extends Error {}

async function readJson<T extends z.ZodType>(response: Response, schema: T): Promise<z.output<T>> {
  if (!response.ok) {
    throw new SocialProviderError(`Provider answered ${response.status}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new SocialProviderError("Provider sent an unexpected response");
  return parsed.data;
}

const tokenResponse = z.object({ access_token: z.string().min(1) });

function google(
  credentials: OAuthClientCredentials,
  base: string | undefined,
  fetcher: typeof fetch,
): SocialProvider {
  const urls = base
    ? {
        authorize: `${base}/google/authorize`,
        token: `${base}/google/token`,
        userinfo: `${base}/google/userinfo`,
      }
    : {
        authorize: "https://accounts.google.com/o/oauth2/v2/auth",
        token: "https://oauth2.googleapis.com/token",
        userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
      };
  const userinfo = z.object({
    sub: z.string().min(1),
    email: z.string(),
    email_verified: z.boolean().optional(),
    name: z.string().optional(),
  });

  return {
    name: "google",
    authorizeUrl: ({ state, codeChallenge, redirectUri }) => {
      const url = new URL(urls.authorize);
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString();
      return url.toString();
    },
    async fetchProfile({ code, codeVerifier, redirectUri }) {
      const token = await readJson(
        await fetcher(urls.token, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            code,
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            code_verifier: codeVerifier,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
        tokenResponse,
      );
      const profile = await readJson(
        await fetcher(urls.userinfo, {
          headers: { Authorization: `Bearer ${token.access_token}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
        userinfo,
      );
      return {
        id: profile.sub,
        email: profile.email.trim().toLowerCase(),
        emailVerified: profile.email_verified === true,
        name: profile.name?.trim() || profile.email.split("@")[0]!,
      };
    },
  };
}

function github(
  credentials: OAuthClientCredentials,
  base: string | undefined,
  fetcher: typeof fetch,
): SocialProvider {
  const urls = base
    ? {
        authorize: `${base}/github/authorize`,
        token: `${base}/github/token`,
        api: `${base}/github/api`,
      }
    : {
        authorize: "https://github.com/login/oauth/authorize",
        token: "https://github.com/login/oauth/access_token",
        api: "https://api.github.com",
      };
  const user = z.object({
    id: z.union([z.number(), z.string()]),
    login: z.string(),
    name: z.string().nullable().optional(),
  });
  const emails = z.array(
    z.object({ email: z.string(), primary: z.boolean(), verified: z.boolean() }),
  );

  return {
    name: "github",
    authorizeUrl: ({ state, codeChallenge, redirectUri }) => {
      const url = new URL(urls.authorize);
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        scope: "read:user user:email",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        allow_signup: "true",
      }).toString();
      return url.toString();
    },
    async fetchProfile({ code, codeVerifier, redirectUri }) {
      // GitHub reports failures with a 200 and an `error` field, which the schema rejects.
      const token = await readJson(
        await fetcher(urls.token, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
        tokenResponse,
      );
      const headers = {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Tessel",
      };
      const [account, addresses] = await Promise.all([
        fetcher(`${urls.api}/user`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) }).then(
          (response) => readJson(response, user),
        ),
        fetcher(`${urls.api}/user/emails`, {
          headers,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }).then((response) => readJson(response, emails)),
      ]);
      // The primary address, if verified; otherwise any verified one.
      const chosen =
        addresses.find((address) => address.primary && address.verified) ??
        addresses.find((address) => address.verified) ??
        addresses.find((address) => address.primary);
      if (!chosen) throw new SocialProviderError("The GitHub account has no email address");
      return {
        id: String(account.id),
        email: chosen.email.trim().toLowerCase(),
        emailVerified: chosen.verified,
        name: account.name?.trim() || account.login,
      };
    },
  };
}

/** The sign-in providers this deployment has credentials for. */
export function createSocialProviders({
  google: googleCredentials,
  github: githubCredentials,
  mockBaseUrl,
  fetch: fetcher = fetch,
}: SocialProvidersOptions): Partial<Record<IdentityProvider, SocialProvider>> {
  const base = mockBaseUrl?.replace(/\/$/, "");
  return {
    ...(googleCredentials ? { google: google(googleCredentials, base, fetcher) } : {}),
    ...(githubCredentials ? { github: github(githubCredentials, base, fetcher) } : {}),
  };
}
