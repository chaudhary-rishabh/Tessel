import type { CookieOptions, Request, Response } from "express";

export const REFRESH_COOKIE_NAME = "tessel_rt";

export interface RefreshCookie {
  set(res: Response, token: string): void;
  clear(res: Response): void;
  read(req: Request): string | undefined;
}

/**
 * The refresh token lives only in this cookie: httpOnly (no JavaScript
 * access), SameSite=Strict (not sent cross-site), and scoped to /auth so it
 * is never sent with ordinary API calls.
 */
export function createRefreshCookie({
  secure,
  maxAgeMs,
}: {
  secure: boolean;
  maxAgeMs: number;
}): RefreshCookie {
  const base: CookieOptions = { httpOnly: true, secure, sameSite: "strict", path: "/auth" };

  return {
    set: (res, token) => res.cookie(REFRESH_COOKIE_NAME, token, { ...base, maxAge: maxAgeMs }),
    clear: (res) => res.clearCookie(REFRESH_COOKIE_NAME, base),
    read: (req) => {
      const value: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
      return typeof value === "string" && value.length > 0 && value.length <= 256
        ? value
        : undefined;
    },
  };
}
