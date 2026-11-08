import { apiErrorSchema } from "@tessel/contracts";
import { isAxiosError } from "axios";

export interface FieldIssue {
  path: string;
  message: string;
}

/**
 * Every failed request becomes this one error type, so UI code handles
 * errors in one way whether the API answered or the network failed.
 */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  /** True when the request never got an HTTP response (offline, DNS, CORS, timeout). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }

  /** Field-level problems from a validation error, if any. */
  get fieldIssues(): FieldIssue[] {
    if (this.code !== "validation_error" || !Array.isArray(this.details)) return [];
    return this.details.filter(
      (issue): issue is FieldIssue =>
        typeof issue?.path === "string" && typeof issue?.message === "string",
    );
  }
}

export function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;

  if (isAxiosError(error)) {
    if (!error.response) {
      return new ApiClientError(
        0,
        "network_error",
        "Can't reach Tessel. Check your connection and try again.",
      );
    }
    const parsed = apiErrorSchema.safeParse(error.response.data);
    if (parsed.success) {
      const { code, message, requestId, details } = parsed.data.error;
      return new ApiClientError(error.response.status, code, message, requestId, details);
    }
    return new ApiClientError(
      error.response.status,
      "unexpected_response",
      `The server responded with an unexpected error (${error.response.status}).`,
    );
  }

  return new ApiClientError(0, "unknown_error", "Something went wrong. Try again.");
}
