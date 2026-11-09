import { createApi, createApiClient, type Api } from "@tessel/api-client";
import { env } from "./env";
import { useSessionStore } from "./session-store";

let api: Api | undefined;

/** The browser's single API client, wired to the session store. */
export function getApi(): Api {
  api ??= createApi(
    createApiClient({
      baseURL: env.apiUrl,
      getAccessToken: () => useSessionStore.getState().accessToken,
      onSessionRefreshed: (auth) => useSessionStore.getState().setSession(auth),
      onSessionExpired: () => useSessionStore.getState().clear("expired"),
    }),
  );
  return api;
}
