import { createHash } from "node:crypto";
import {
  identityParamsSchema,
  oauthExchangeRequestSchema,
  oauthStartQuerySchema,
  phoneCodeRequestSchema,
  phoneVerifyRequestSchema,
  type SignInOptions,
  type TwoFactorRequired,
} from "@tessel/contracts";
import { Router, type CookieOptions, type RequestHandler, type Response } from "express";
import type { RateLimitConfig } from "../../config";
import { requireAllowedOrigin } from "../../middleware/origin-check";
import { createRateLimiter, type RateLimitStoreFactory } from "../../middleware/rate-limit";
import { getAuth } from "../../middleware/require-auth";
import type { LoginOutcome } from "./auth.service";
import type { RefreshCookie } from "./cookies";
import type { PhoneService } from "./phone.service";
import { sessionMeta } from "./session-meta";
import type { SocialService } from "./social.service";

const STATE_COOKIE = "tessel_oauth";

interface SignInRouterOptions {
  social: SocialService;
  phone: PhoneService;
  refreshCookie: RefreshCookie;
  authenticate: RequestHandler;
  cookieSecure: boolean;
  rateLimits: RateLimitConfig;
  storeFactory?: RateLimitStoreFactory | undefined;
  allowedOrigins: readonly string[];
}

/** Rate limit keys use a hash of the phone number, so Redis never stores it. */
const phoneKey = (value: unknown) =>
  typeof value === "string"
    ? createHash("sha256")
        .update(value.replace(/[^\d+]/g, ""))
        .digest("hex")
        .slice(0, 32)
    : undefined;

function sendOutcome(res: Response, cookie: RefreshCookie, outcome: LoginOutcome) {
  if (outcome.kind === "two_factor") {
    const body: TwoFactorRequired = {
      status: "two_factor_required",
      challengeToken: outcome.challengeToken,
    };
    res.json(body);
    return;
  }
  cookie.set(res, outcome.session.refreshToken);
  res.json(outcome.session.auth);
}

/**
 * Other ways to sign in, under /auth: Google and GitHub (with the redirect
 * and callback), and texted codes.
 */
export function createSignInRouter({
  social,
  phone,
  refreshCookie,
  authenticate,
  cookieSecure,
  rateLimits,
  storeFactory,
  allowedOrigins,
}: SignInRouterOptions): Router {
  const router = Router();
  // Lax, not Strict: the browser comes back to the callback from the provider's site.
  const stateCookie: CookieOptions = {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/auth/oauth",
  };
  const loginLimiter = createRateLimiter({ name: "login", ...rateLimits.login, storeFactory });
  const phoneLimiter = createRateLimiter({
    name: "phone",
    ...rateLimits.signup,
    storeFactory,
    // Per number too, so nobody can flood a phone with texts from many IPs.
    keySuffix: (req) => phoneKey(req.body?.phone),
  });

  router.use(requireAllowedOrigin(allowedOrigins));

  router.get("/options", (_req, res) => {
    const options: SignInOptions = {
      google: social.enabled("google"),
      github: social.enabled("github"),
      phone: phone.enabled,
    };
    res.set("Cache-Control", "public, max-age=300").json(options);
  });

  // Google and GitHub: a browser navigation, so it answers with a redirect.
  router.get("/oauth/:provider/start", loginLimiter, (req, res) => {
    const { provider } = identityParamsSchema.parse(req.params);
    const { next } = oauthStartQuerySchema.parse(req.query);
    const started = social.startLogin(provider, next);
    res.cookie(STATE_COOKIE, started.cookie, { ...stateCookie, maxAge: started.maxAgeMs });
    res.redirect(303, started.url);
  });

  // Linking from Settings: the signed-in app asks for the URL, then navigates to it.
  router.post("/oauth/:provider/link", authenticate, (req, res) => {
    const { provider } = identityParamsSchema.parse(req.params);
    const started = social.startLink(provider, getAuth(req).userId);
    res.cookie(STATE_COOKIE, started.cookie, { ...stateCookie, maxAge: started.maxAgeMs });
    res.json({ url: started.url });
  });

  router.get("/oauth/:provider/callback", loginLimiter, async (req, res) => {
    const { provider } = identityParamsSchema.parse(req.params);
    const text = (value: unknown) =>
      typeof value === "string" ? value.slice(0, 2_000) : undefined;
    const cookie: unknown = req.cookies?.[STATE_COOKIE];
    const destination = await social.callback(
      provider,
      { code: text(req.query.code), state: text(req.query.state), error: text(req.query.error) },
      typeof cookie === "string" ? cookie : undefined,
    );
    res.clearCookie(STATE_COOKIE, stateCookie);
    res.redirect(303, destination);
  });

  router.post("/oauth/exchange", loginLimiter, async (req, res) => {
    const { ticket } = oauthExchangeRequestSchema.parse(req.body);
    sendOutcome(res, refreshCookie, await social.exchange(ticket, sessionMeta(req)));
  });

  router.post("/phone/start", phoneLimiter, async (req, res) => {
    const { phone: number } = phoneCodeRequestSchema.parse(req.body);
    res.status(202).json(await phone.startLogin(number));
  });

  router.post("/phone/verify", loginLimiter, async (req, res) => {
    const input = phoneVerifyRequestSchema.parse(req.body);
    sendOutcome(res, refreshCookie, await phone.verifyLogin(input, sessionMeta(req)));
  });

  return router;
}

/** The signed-in user's sign-in methods, under /users/me. */
export function createSignInMethodsRouter({
  social,
  phone,
  authenticate,
  rateLimits,
  storeFactory,
}: Pick<
  SignInRouterOptions,
  "social" | "phone" | "authenticate" | "rateLimits" | "storeFactory"
>): Router {
  const router = Router();
  const phoneLimiter = createRateLimiter({
    name: "phone",
    ...rateLimits.signup,
    storeFactory,
    keySuffix: (req) => phoneKey(req.body?.phone),
  });
  const codeLimiter = createRateLimiter({
    name: "password",
    ...rateLimits.password,
    storeFactory,
    keySuffix: (req) => req.auth?.userId,
  });

  router.use(authenticate);
  router.get("/identities", async (req, res) => {
    res.json({ identities: await social.list(getAuth(req).userId) });
  });
  router.delete("/identities/:provider", async (req, res) => {
    const { provider } = identityParamsSchema.parse(req.params);
    await social.unlink(getAuth(req).userId, provider);
    res.status(204).end();
  });
  router.post("/phone", phoneLimiter, async (req, res) => {
    const { phone: number } = phoneCodeRequestSchema.parse(req.body);
    res.status(202).json(await phone.startVerify(getAuth(req).userId, number));
  });
  router.post("/phone/verify", codeLimiter, async (req, res) => {
    const input = phoneVerifyRequestSchema.parse(req.body);
    res.json(await phone.confirm(getAuth(req).userId, input));
  });
  router.delete("/phone", async (req, res) => {
    res.json(await phone.remove(getAuth(req).userId));
  });

  return router;
}
