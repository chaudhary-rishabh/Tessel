import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

/** How a connection signs in to its server. Stored encrypted. */
export type ConnectionCredentials =
  | { type: "none" }
  | { type: "token"; token: string }
  | {
      type: "oauth";
      client?: OAuthClientInformationMixed;
      tokens?: OAuthTokens;
      codeVerifier?: string;
    };

/** A pre-registered OAuth app, for servers without dynamic client registration (e.g. GitHub). */
export interface StaticOAuthClient {
  clientId: string;
  clientSecret?: string;
}

/**
 * The MCP SDK's OAuth client hooks, backed by one connection's credentials.
 * The SDK does discovery, dynamic client registration, PKCE, the code
 * exchange, and token refresh; this keeps the results and reports changes
 * so the caller can save them.
 */
export class ConnectionOAuthProvider implements OAuthClientProvider {
  /** Set when the SDK wants the user sent to the authorization page. */
  authorizationUrl: URL | undefined;

  constructor(
    private credentials: Extract<ConnectionCredentials, { type: "oauth" }>,
    private readonly options: {
      redirectUrl: string;
      clientName: string;
      /** Sent as `state`, to find this connection again in the callback. */
      state?: string;
      staticClient?: StaticOAuthClient | undefined;
      onChange: (credentials: ConnectionCredentials) => void | Promise<void>;
    },
  ) {}

  get redirectUrl() {
    return this.options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.options.clientName,
      redirect_uris: [this.options.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.options.staticClient?.clientSecret
        ? "client_secret_post"
        : "none",
    };
  }

  state() {
    return this.options.state ?? "";
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const fixed = this.options.staticClient;
    if (fixed) {
      return {
        client_id: fixed.clientId,
        ...(fixed.clientSecret ? { client_secret: fixed.clientSecret } : {}),
      };
    }
    return this.credentials.client;
  }

  async saveClientInformation(client: OAuthClientInformationMixed) {
    await this.update({ client });
  }

  tokens() {
    return this.credentials.tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    // Servers may omit the refresh token on refresh; keep the old one then.
    const refresh = tokens.refresh_token ?? this.credentials.tokens?.refresh_token;
    await this.update({ tokens: { ...tokens, ...(refresh ? { refresh_token: refresh } : {}) } });
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }

  async saveCodeVerifier(codeVerifier: string) {
    await this.update({ codeVerifier });
  }

  codeVerifier() {
    if (!this.credentials.codeVerifier)
      throw new Error("No sign-in in progress for this connection");
    return this.credentials.codeVerifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    const next = { ...this.credentials };
    if (scope === "all" || scope === "tokens") delete next.tokens;
    if (scope === "all" || scope === "client") delete next.client;
    if (scope === "all" || scope === "verifier") delete next.codeVerifier;
    this.credentials = next;
    await this.options.onChange(next);
  }

  private async update(patch: Partial<Extract<ConnectionCredentials, { type: "oauth" }>>) {
    this.credentials = { ...this.credentials, ...patch };
    await this.options.onChange(this.credentials);
  }
}
