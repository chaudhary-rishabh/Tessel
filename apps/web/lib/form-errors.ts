import { toApiClientError } from "@tessel/api-client";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/**
 * Puts an API error where the user will see it: on the matching field when
 * the API names one, otherwise as a message for the whole form.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): void {
  const apiError = toApiClientError(error);

  const issues = apiError.fieldIssues.filter((issue) => fields.includes(issue.path as Path<T>));
  if (issues.length > 0) {
    for (const issue of issues) {
      setError(issue.path as Path<T>, { message: issue.message });
    }
    return;
  }

  const message =
    apiError.code === "rate_limited"
      ? "Too many attempts. Wait a few minutes, then try again."
      : apiError.message;
  setError("root.server", { message });
}

/** Only allow redirects to paths inside this app, never to another site. */
export function safeNextPath(next: string | null, fallback = "/chat"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
