"use client";

import { toApiClientError } from "@tessel/api-client";
import { Button, TextField } from "@tessel/ui";
import { useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";

/**
 * One six-digit code field. Typing or pasting a full code submits it, so a
 * code read off a phone takes one step.
 */
export function CodeForm({
  label,
  submitLabel,
  onSubmit,
  hint,
  className = "mt-8",
}: {
  label: string;
  submitLabel: string;
  hint?: string;
  className?: string;
  onSubmit: (code: string) => Promise<unknown>;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(value: string) {
    if (submitting) return;
    if (!/^\d{6}$/.test(value)) {
      setError("Enter the 6-digit code");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onSubmit(value);
    } catch (caught) {
      const apiError = toApiClientError(caught);
      setError(
        apiError.code === "rate_limited"
          ? "Too many attempts. Wait a few minutes, then try again."
          : apiError.message,
      );
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      noValidate
      className={`flex flex-col gap-5 ${className}`}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void submit(code);
      }}
    >
      <FormError message={error} />
      <TextField
        label={label}
        hint={hint}
        value={code}
        autoFocus
        autoComplete="one-time-code"
        inputMode="numeric"
        maxLength={7}
        inputClassName="font-display h-14 text-center text-2xl tracking-[0.4em] tabular-nums"
        onChange={(event) => {
          const value = event.target.value.replace(/\D/g, "").slice(0, 6);
          setCode(value);
          if (value.length === 6) void submit(value);
        }}
      />
      <Button type="submit" loading={submitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
