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
import {
  createRateLimiter,
  phoneKey,
  userKey,
  type RateLimitStoreFactory,
} from "../../middleware/rate-limit";
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
  // A Google or GitHub sign-in takes three requests (start, callback, exchange).
  const socialLimiter = createRateLimiter({
    name: "social",
    windowMs: rateLimits.login.windowMs,
    limit: rateLimits.login.limit * 3,
    storeFactory,
  });
  const textIp = createRateLimiter({ name: "phone-ip", ...rateLimits.signup, storeFactory });
  // Per number on its own, so nobody can flood a phone with texts from many IPs.
  const textNumber = createRateLimiter({
    name: "phone-number",
    ...rateLimits.signup,
    storeFactory,
    key: phoneKey,
  });
  const codeCheck = createRateLimiter({ name: "phone-login", ...rateLimits.login, storeFactory });

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
  router.get("/oauth/:provider/start", socialLimiter, (req, res) => {
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

  router.get("/oauth/:provider/callback", socialLimiter, async (req, res) => {
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

  router.post("/oauth/exchange", socialLimiter, async (req, res) => {
    const { ticket } = oauthExchangeRequestSchema.parse(req.body);
    sendOutcome(res, refreshCookie, await social.exchange(ticket, sessionMeta(req)));
  });

  router.post("/phone/start", textIp, textNumber, async (req, res) => {
    const { phone: number } = phoneCodeRequestSchema.parse(req.body);
    res.status(202).json(await phone.startLogin(number));
  });

  router.post("/phone/verify", codeCheck, async (req, res) => {
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
  // A signed-in user adding a number: per number, and per user per day, so
  // one account can't send texts to number after number.
  const textNumber = createRateLimiter({
    name: "phone-add-number",
    ...rateLimits.signup,
    storeFactory,
    key: phoneKey,
  });
  const textUser = createRateLimiter({
    name: "phone-add-user",
    windowMs: 24 * 60 * 60 * 1000,
    limit: rateLimits.signup.limit,
    storeFactory,
    key: userKey,
  });
  const codeCheck = createRateLimiter({
    name: "phone-add-code",
    ...rateLimits.password,
    storeFactory,
    key: userKey,
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
  router.post("/phone", textUser, textNumber, async (req, res) => {
    const { phone: number } = phoneCodeRequestSchema.parse(req.body);
    res.status(202).json(await phone.startVerify(getAuth(req).userId, number));
  });
  router.post("/phone/verify", codeCheck, async (req, res) => {
    const input = phoneVerifyRequestSchema.parse(req.body);
    res.json(await phone.confirm(getAuth(req).userId, input));
  });
  router.delete("/phone", async (req, res) => {
    res.json(await phone.remove(getAuth(req).userId));
  });

  return router;
}
