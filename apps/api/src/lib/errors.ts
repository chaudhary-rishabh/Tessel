/**
 * An expected error with an HTTP status and a stable machine-readable code.
 * Anything thrown that is not an AppError becomes a generic 500.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errors = {
  badRequest: (code: string, message: string, details?: unknown) =>
    new AppError(400, code, message, details),
  unauthorized: (code = "unauthorized", message = "Authentication required") =>
    new AppError(401, code, message),
  forbidden: (message = "You don't have permission to do this", code = "forbidden") =>
    new AppError(403, code, message),
  notFound: (message = "Not found") => new AppError(404, "not_found", message),
  conflict: (code: string, message: string) => new AppError(409, code, message),
};

const UNIQUE_VIOLATION = "23505";

/** True when a database error (possibly wrapped by Drizzle) is a unique-constraint violation. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (typeof current === "object" && "code" in current && current.code === UNIQUE_VIOLATION) {
      return !constraint || ("constraint" in current && current.constraint === constraint);
    }
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
  }
  return false;
}
