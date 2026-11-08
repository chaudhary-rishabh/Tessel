import { randomUUID } from "node:crypto";
import type { AuthResponse } from "@tessel/contracts";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";
import { ApiClientError } from "./errors";

const userId = randomUUID();

function authResponse(accessToken: string): AuthResponse {
  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn: 900,
    user: {
      id: userId,
      email: "ada@example.com",
      name: "Ada",
      role: "user",
      createdAt: "2026-11-08T10:00:00.000Z",
    },
  };
}

function reply(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  const response = { data, status, statusText: String(status), headers: {}, config };
  if (status >= 400) {
    throw new AxiosError(
      `Request failed with status ${status}`,
      "ERR_BAD_REQUEST",
      config,
      null,
      response,
    );
  }
  return response;
}

const apiError = (code: string, message = code) => ({ error: { code, message } });

type Handler = (
  config: InternalAxiosRequestConfig,
) => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>>;

/** A fake server: routes requests by method and path and records them. */
function fakeServer(routes: Record<string, Handler>) {
  const calls: { route: string; authorization: string | undefined }[] = [];
  const adapter: AxiosAdapter = async (config) => {
    const route = `${config.method?.toUpperCase()} ${config.url}`;
    calls.push({ route, authorization: config.headers.get("Authorization")?.toString() });
    const handler = routes[route];
    if (!handler) return reply(config, 404, apiError("not_found"));
    return handler(config);
  };
  return { adapter, calls };
}

function setup(routes: Record<string, Handler>, initialToken = "expired-token") {
  const server = fakeServer(routes);
  let token: string | null = initialToken;
  const onSessionRefreshed = vi.fn((auth: AuthResponse) => {
    token = auth.accessToken;
  });
  const onSessionExpired = vi.fn(() => {
    token = null;
  });
  const client = createApiClient({
    baseURL: "http://api.test",
    getAccessToken: () => token,
    onSessionRefreshed,
    onSessionExpired,
    rotationRetryDelayMs: 1,
    adapter: server.adapter,
  });
  return { ...client, ...server, onSessionRefreshed, onSessionExpired, getToken: () => token };
}

/** Protected route that only accepts the given token. */
const requireToken =
  (valid: string): Handler =>
  (config) =>
    config.headers.get("Authorization") === `Bearer ${valid}`
      ? reply(config, 200, { ok: true })
      : reply(config, 401, apiError("invalid_token"));

describe("createApiClient", () => {
  it("sends the access token on every request", async () => {
    const { http, calls } = setup({ "GET /users/me": requireToken("good") }, "good");
    await http.get("/users/me");
    expect(calls[0]?.authorization).toBe("Bearer good");
  });

  it("refreshes once on a 401 and retries the request with the new token", async () => {
    const { http, calls, onSessionRefreshed, getToken } = setup({
      "GET /users/me": requireToken("fresh"),
      "POST /auth/refresh": (config) => reply(config, 200, authResponse("fresh")),
    });

    const response = await http.get("/users/me");
    expect(response.data).toEqual({ ok: true });
    expect(calls.map((call) => call.route)).toEqual([
      "GET /users/me",
      "POST /auth/refresh",
      "GET /users/me",
    ]);
    expect(onSessionRefreshed).toHaveBeenCalledOnce();
    expect(getToken()).toBe("fresh");
  });

  it("shares one refresh between requests that fail at the same time", async () => {
    let refreshes = 0;
    const { http, calls } = setup({
      "GET /users/me": requireToken("fresh"),
      "GET /workspaces": requireToken("fresh"),
      "POST /auth/refresh": async (config) => {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return reply(config, 200, authResponse("fresh"));
      },
    });

    await Promise.all([http.get("/users/me"), http.get("/workspaces"), http.get("/users/me")]);
    expect(refreshes).toBe(1);
    expect(calls.filter((call) => call.route === "POST /auth/refresh")).toHaveLength(1);
  });

  it("ends the session when the refresh is rejected", async () => {
    const { http, onSessionExpired, getToken } = setup({
      "GET /users/me": requireToken("never"),
      "POST /auth/refresh": (config) => reply(config, 401, apiError("invalid_refresh_token")),
    });

    const error = await http.get("/users/me").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).status).toBe(401);
    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(getToken()).toBeNull();
  });

  it("keeps the session when the refresh fails because of the network", async () => {
    const { http, onSessionExpired } = setup({
      "GET /users/me": requireToken("never"),
      "POST /auth/refresh": (config) => {
        throw new AxiosError("Network Error", "ERR_NETWORK", config);
      },
    });

    const error = (await http
      .get("/users/me")
      .catch((caught: unknown) => caught)) as ApiClientError;
    expect(error.isNetworkError).toBe(true);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("retries a refresh that raced with another tab", async () => {
    let attempts = 0;
    const { http } = setup({
      "GET /users/me": requireToken("fresh"),
      "POST /auth/refresh": (config) => {
        attempts += 1;
        return attempts === 1
          ? reply(config, 401, apiError("refresh_token_rotated"))
          : reply(config, 200, authResponse("fresh"));
      },
    });

    await expect(http.get("/users/me")).resolves.toMatchObject({ data: { ok: true } });
    expect(attempts).toBe(2);
  });

  it("does not try to refresh after a failed login", async () => {
    const { http, calls } = setup({
      "POST /auth/login": (config) => reply(config, 401, apiError("invalid_credentials")),
    });

    const error = (await http
      .post("/auth/login", {})
      .catch((caught: unknown) => caught)) as ApiClientError;
    expect(error.code).toBe("invalid_credentials");
    expect(calls.map((call) => call.route)).toEqual(["POST /auth/login"]);
  });

  it("retries only once, even if the new token is also rejected", async () => {
    const { http, calls } = setup({
      "GET /users/me": requireToken("never"),
      "POST /auth/refresh": (config) => reply(config, 200, authResponse("still-wrong")),
    });

    await expect(http.get("/users/me")).rejects.toMatchObject({ status: 401 });
    expect(calls.filter((call) => call.route === "GET /users/me")).toHaveLength(2);
  });

  it("turns API errors into ApiClientError with field issues", async () => {
    const { http } = setup({
      "POST /auth/signup": (config) =>
        reply(config, 400, {
          error: {
            code: "validation_error",
            message: "Some fields are invalid",
            requestId: "req-1",
            details: [{ path: "email", message: "Enter a valid email address" }],
          },
        }),
    });

    const error = (await http
      .post("/auth/signup", {})
      .catch((caught: unknown) => caught)) as ApiClientError;
    expect(error).toMatchObject({ status: 400, code: "validation_error", requestId: "req-1" });
    expect(error.fieldIssues).toEqual([{ path: "email", message: "Enter a valid email address" }]);
  });
});
