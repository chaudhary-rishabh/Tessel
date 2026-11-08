import type { UserRole } from "@tessel/contracts";

export interface AuthContext {
  userId: string;
  role: UserRole;
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
