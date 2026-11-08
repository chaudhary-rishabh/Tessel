import { createHash, randomBytes } from "node:crypto";
import type { Identity, IdentityProvider } from "@tessel/contracts";
import { loginTickets, userIdentities, users, type Database, type UserRow } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import type { SecretBox } from "@tessel/mcp";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { errors, isUniqueViolation } from "../../lib/errors";
import { emails, type Mailer } from "../../lib/mailer";
import { noAudit, type AuditRecorder } from "../../lib/audit";
import { usersRepository } from "../users/users.repository";
import { createAccount } from "./accounts";
import type { LoginOutcome, SessionMeta, SignInMethod } from "./auth.service";
import { assertNotLastSignInMethod } from "./sign-in-methods";
import type { SocialProvider, SocialProfile } from "./social-providers";
import { hashToken } from "./tokens";

const STATE_TTL_MS = 10 * 60_000;
const TICKET_TTL_MS = 2 * 60_000;

export const PROVIDER_LABELS: Record<IdentityProvider, string> = {
  google: "Google",
  github: "GitHub",
};

/** What the state cookie carries between the redirect and the callback. Sealed, so it can't be read or changed. */
interface OAuthState {
  provider: IdentityProvider;
  state: string;
  verifier: string;
  mode: "login" | "link";
  /** For linking: the signed-in user. */
  userId?: string;
  /** For login: where to go afterwards. */
  next?: string;
  expiresAt: number;
}

/** Why a sign-in didn't finish, as shown on the web app's login page. */
export type SocialErrorCode =
  "oauth_cancelled" | "oauth_expired" | "oauth_failed" | "email_unverified" | "identity_taken";

const base64url = (bytes: Buffer) => bytes.toString("base64url");

export interface SocialServiceDependencies {
  db: Database;
  logger: Logger;
  box: SecretBox;
  mailer: Mailer;
  providers: Partial<Record<IdentityProvider, SocialProvider>>;
  /** Where providers send the browser back: API_PUBLIC_URL/auth/oauth/:provider/callback. */
  callbackUrl: (provider: IdentityProvider) => string;
  webOrigin: string;
  /** Signs in (or asks for the authenticator code) once the account is known. */
  beginSession: (user: UserRow, meta: SessionMeta, method: SignInMethod) => Promise<LoginOutcome>;
  audit?: AuditRecorder;
  now?: () => Date;
}

/** Sign in with Google or GitHub, and linking them to an existing account. */
export function createSocialService({
  db,
  logger,
  box,
  mailer,
  providers,
  callbackUrl,
  webOrigin,
  beginSession,
  audit = noAudit,
  now = () => new Date(),
}: SocialServiceDependencies) {
  function provider(name: IdentityProvider): SocialProvider {
    const found = providers[name];
    if (!found) throw errors.notFound(`Signing in with ${PROVIDER_LABELS[name]} isn't set up`);
    return found;
  }

  /** The URL to send the browser to, and the sealed state for the cookie. */
  function start(name: IdentityProvider, extra: Pick<OAuthState, "mode" | "userId" | "next">) {
    const verifier = base64url(randomBytes(32));
    const state = base64url(randomBytes(24));
    const sealed: OAuthState = {
      provider: name,
      state,
      verifier,
      ...extra,
      expiresAt: now().getTime() + STATE_TTL_MS,
    };
    const url = provider(name).authorizeUrl({
      state,
      codeChallenge: base64url(createHash("sha256").update(verifier).digest()),
      redirectUri: callbackUrl(name),
    });
    return { url, cookie: box.seal(sealed), maxAgeMs: STATE_TTL_MS };
  }

  function readState(
    cookie: string | undefined,
    name: IdentityProvider,
    state: string | undefined,
  ) {
    if (!cookie || !state) return undefined;
    try {
      const sealed = box.open<OAuthState>(cookie);
      if (sealed.provider !== name || sealed.expiresAt < now().getTime()) return undefined;
      // Compare hashes so the check takes the same time however much matches.
      if (hashToken(sealed.state) !== hashToken(state)) return undefined;
      return sealed;
    } catch {
      return undefined;
    }
  }

  async function issueTicket(userId: string, provider: IdentityProvider): Promise<string> {
    const ticket = base64url(randomBytes(32));
    await db.insert(loginTickets).values({
      userId,
      provider,
      ticketHash: hashToken(ticket),
      expiresAt: new Date(now().getTime() + TICKET_TTL_MS),
    });
    return ticket;
  }

  /** The account for a provider profile: already linked, matched by verified email, or new. */
  async function accountFor(
    name: IdentityProvider,
    profile: SocialProfile,
    retried = false,
  ): Promise<{ user: UserRow; linked: boolean; created?: boolean } | SocialErrorCode> {
    const [identity] = await db
      .select()
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, name), eq(userIdentities.providerUserId, profile.id)));
    if (identity) {
      const user = await usersRepository.findById(db, identity.userId);
      return user ? { user, linked: false } : "oauth_failed";
    }
    // Only an email the provider has verified can match or create an account.
    if (!profile.emailVerified) return "email_unverified";

    try {
      return await db.transaction(async (tx) => {
        const existing = await usersRepository.findByEmail(tx, profile.email);
        const user =
          existing ??
          (await createAccount(tx, {
            email: profile.email,
            name: profile.name.slice(0, 100),
            passwordHash: null,
            emailVerifiedAt: now(),
          }));
        await tx.insert(userIdentities).values({
          userId: user.id,
          provider: name,
          providerUserId: profile.id,
          email: profile.email,
        });
        if (existing && !existing.emailVerifiedAt) {
          await tx.update(users).set({ emailVerifiedAt: now() }).where(eq(users.id, existing.id));
        }
        return { user, linked: Boolean(existing), created: !existing };
      });
    } catch (error) {
      // The account already has a different Google (or GitHub) account linked.
      if (isUniqueViolation(error, "user_identities_user_provider_unique")) return "identity_taken";
      // Two first sign-ins raced (two tabs, a double click); the other one made the account.
      if (isUniqueViolation(error) && !retried) return accountFor(name, profile, true);
      throw error;
    }
  }

  const loginError = (code: SocialErrorCode) => `${webOrigin}/login?error=${code}`;
  const settingsUrl = (query: string) => `${webOrigin}/settings?${query}#sign-in-methods`;

  return {
    enabled: (name: IdentityProvider) => Boolean(providers[name]),

    startLogin: (name: IdentityProvider, next: string | undefined) =>
      start(name, { mode: "login", ...(next ? { next } : {}) }),

    startLink: (name: IdentityProvider, userId: string) => start(name, { mode: "link", userId }),

    /**
     * Finishes the provider redirect and says where to send the browser: the
     * web app with a one-time ticket, or back with an error code.
     */
    async callback(
      name: IdentityProvider,
      query: { code?: string | undefined; state?: string | undefined; error?: string | undefined },
      cookie: string | undefined,
    ): Promise<string> {
      const sealed = readState(cookie, name, query.state);
      if (!sealed) return loginError("oauth_expired");
      const fail = (code: SocialErrorCode) =>
        sealed.mode === "link" ? settingsUrl(`link_error=${code}`) : loginError(code);
      if (query.error || !query.code) return fail("oauth_cancelled");

      let profile: SocialProfile;
      try {
        profile = await provider(name).fetchProfile({
          code: query.code,
          codeVerifier: sealed.verifier,
          redirectUri: callbackUrl(name),
        });
      } catch (error) {
        logger.warn({ err: error, provider: name }, "Sign-in provider exchange failed");
        return fail("oauth_failed");
      }

      if (sealed.mode === "link") {
        const user = sealed.userId ? await usersRepository.findById(db, sealed.userId) : undefined;
        if (!user) return loginError("oauth_expired");
        try {
          await db.insert(userIdentities).values({
            userId: user.id,
            provider: name,
            providerUserId: profile.id,
            email: profile.email,
          });
        } catch (error) {
          if (isUniqueViolation(error)) return fail("identity_taken");
          throw error;
        }
        logger.info({ userId: user.id, provider: name }, "Sign-in method linked");
        await audit.record({
          actorId: user.id,
          action: "auth.sign_in_method_added",
          metadata: { method: name },
        });
        await mailer.send(emails.signInMethodAdded(user.email, PROVIDER_LABELS[name]));
        return settingsUrl(`linked=${name}`);
      }

      const account = await accountFor(name, profile);
      if (typeof account === "string") return fail(account);
      if (account.linked) {
        await mailer.send(emails.signInMethodAdded(account.user.email, PROVIDER_LABELS[name]));
        await audit.record({
          actorId: account.user.id,
          action: "auth.sign_in_method_added",
          metadata: { method: name, matchedBy: "email" },
        });
      } else if (account.created) {
        await audit.record({
          actorId: account.user.id,
          action: "auth.signed_up",
          metadata: { method: name },
        });
      }
      const ticket = await issueTicket(account.user.id, name);
      const next = sealed.next ? `?next=${encodeURIComponent(sealed.next)}` : "";
      // The ticket goes in the fragment, so it never reaches a server log or a Referer header.
      return `${webOrigin}/oauth/complete${next}#ticket=${ticket}`;
    },

    /** Trades a ticket (once, within two minutes) for a session. */
    async exchange(ticket: string, meta: SessionMeta): Promise<LoginOutcome> {
      const [used] = await db
        .update(loginTickets)
        .set({ usedAt: now() })
        .where(
          and(
            eq(loginTickets.ticketHash, hashToken(ticket)),
            isNull(loginTickets.usedAt),
            gt(loginTickets.expiresAt, now()),
          ),
        )
        .returning({ userId: loginTickets.userId, provider: loginTickets.provider });
      const user = used ? await usersRepository.findById(db, used.userId) : undefined;
      if (!user) {
        throw errors.unauthorized("invalid_ticket", "This sign-in has expired. Try again.");
      }
      return beginSession(user, meta, used?.provider ?? "google");
    },

    async list(userId: string): Promise<Identity[]> {
      const rows = await db
        .select()
        .from(userIdentities)
        .where(eq(userIdentities.userId, userId))
        .orderBy(asc(userIdentities.createdAt));
      return rows.map((row) => ({
        provider: row.provider,
        email: row.email,
        createdAt: row.createdAt.toISOString(),
      }));
    },

    async unlink(userId: string, name: IdentityProvider): Promise<void> {
      const user = await usersRepository.findById(db, userId);
      if (!user) throw errors.unauthorized();
      await assertNotLastSignInMethod(db, user);
      const removed = await db
        .delete(userIdentities)
        .where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, name)))
        .returning({ id: userIdentities.id });
      if (removed.length === 0)
        throw errors.notFound(`No ${PROVIDER_LABELS[name]} account is linked`);
    },
  };
}

export type SocialService = ReturnType<typeof createSocialService>;
