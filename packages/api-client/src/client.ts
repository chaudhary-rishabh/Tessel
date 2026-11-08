import { authResponseSchema, type AuthResponse } from "@tessel/contracts";
import axios, {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import { toApiClientError } from "./errors";

export interface ApiClientOptions {
  baseURL: string;
  /** Current access token, read on every request. Kept in memory only. */
  getAccessToken: () => string | null;
  /** Called whenever a refresh produces a new access token. */
  onSessionRefreshed: (auth: AuthResponse) => void;
  /** Called when the session can no longer be refreshed and the user must log in again. */
  onSessionExpired: () => void;
  /** Wait before retrying a refresh that raced with another tab. */
  rotationRetryDelayMs?: number;
  timeoutMs?: number;
  /** For tests: replaces the HTTP transport. */
  adapter?: AxiosAdapter;
}

export interface ApiClient {
  http: AxiosInstance;
  baseURL: string;
  getAccessToken: () => string | null;
  onSessionExpired: () => void;
  /** Exchanges the refresh cookie for a new access token. Concurrent calls share one request. */
  refreshSession: () => Promise<AuthResponse>;
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retriedAfterRefresh?: boolean;
}

// Requests to these paths never trigger an automatic refresh-and-retry.
// Prefixes, so "/auth/login" also covers the two-step sign-in step.
const NO_REFRESH_PATHS = [
  "/auth/login",
  "/auth/signup",
  "/auth/password",
  "/auth/oauth/exchange",
  "/auth/phone",
  "/auth/refresh",
  "/auth/logout",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createApiClient({
  baseURL,
  getAccessToken,
  onSessionRefreshed,
  onSessionExpired,
  rotationRetryDelayMs = 300,
  timeoutMs = 30_000,
  adapter,
}: ApiClientOptions): ApiClient {
  const shared = {
    baseURL,
    timeout: timeoutMs,
    // Sends the httpOnly refresh cookie to /auth routes.
    withCredentials: true,
    headers: { Accept: "application/json" },
    ...(adapter ? { adapter } : {}),
  };
  const http = axios.create(shared);
  // A separate instance without interceptors, so refreshing can never loop.
  const bare = axios.create(shared);

  let refreshInFlight: Promise<AuthResponse> | null = null;

  async function requestRefresh(): Promise<AuthResponse> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await bare.post("/auth/refresh");
        const auth = authResponseSchema.parse(response.data);
        onSessionRefreshed(auth);
        return auth;
      } catch (error) {
        const apiError = toApiClientError(error);
        // Another tab rotated the token a moment ago; the browser now holds the
        // new cookie, so one retry succeeds.
        if (apiError.code === "refresh_token_rotated" && attempt === 0) {
          await sleep(rotationRetryDelayMs);
          continue;
        }
        throw apiError;
      }
    }
  }

  function refreshSession(): Promise<AuthResponse> {
    refreshInFlight ??= requestRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  http.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token) {
      config.headers.set("Authorization", `Bearer ${token}`);
    }
    return config;
  });

  http.interceptors.response.use(undefined, async (error: unknown) => {
    const apiError = toApiClientError(error);
    const config = axios.isAxiosError(error)
      ? (error.config as RetriableConfig | undefined)
      : undefined;
    const path = config?.url ?? "";

    const canRefresh =
      apiError.status === 401 &&
      config !== undefined &&
      !config._retriedAfterRefresh &&
      !NO_REFRESH_PATHS.some((noRefresh) => path.startsWith(noRefresh));
    if (!canRefresh) throw apiError;

    config._retriedAfterRefresh = true;
    let auth: AuthResponse;
    try {
      auth = await refreshSession();
    } catch (refreshError) {
      const refreshApiError = toApiClientError(refreshError);
      // Only a rejected session logs the user out; a network blip does not.
      if (refreshApiError.status === 401) {
        onSessionExpired();
        throw apiError;
      }
      throw refreshApiError;
    }

    const headers = AxiosHeaders.from(config.headers);
    headers.set("Authorization", `Bearer ${auth.accessToken}`);
    return http({ ...config, headers });
  });

  return { http, refreshSession, baseURL, getAccessToken, onSessionExpired };
}
