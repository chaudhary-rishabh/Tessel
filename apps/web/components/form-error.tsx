import { CircleAlert } from "lucide-react";

/** A form-level error, announced to screen readers as soon as it appears. */
export function FormError({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="border-danger/30 bg-danger/8 text-danger flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

/** Confirms a completed action, announced politely to screen readers. */
export function FormSuccess({ message }: { message?: string | undefined }) {
  return (
    <p role="status" className="text-accent min-h-5 text-sm">
      {message ?? ""}
    </p>
  );
}
