import type { AccessTokenScope, UserRole } from "@tessel/contracts";

export interface AuthContext {
  userId: string;
  role: UserRole;
  /** Set when the request used a personal access token instead of signing in. */
  token?: { id: string; workspaceId: string; scopes: AccessTokenScope[] };
}

declare global {
  namespace Express {
    interface Request {
      /** Set by the request ID middleware for every request. */
      requestId: string;
      /** Set by requireAuth on authenticated routes. */
      auth?: AuthContext;
    }
  }
}
