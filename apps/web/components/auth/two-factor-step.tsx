"use client";

import { toApiClientError } from "@tessel/api-client";
import { Button, TextField } from "@tessel/ui";
import { useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { useCompleteTwoFactor } from "@/hooks/use-auth";
import { CodeForm } from "./code-form";

/** The second sign-in step: an authenticator code, or a recovery code if the phone is lost. */
export function TwoFactorStep({
  challengeToken,
  onExpired,
}: {
  challengeToken: string;
  onExpired: () => void;
}) {
  const complete = useCompleteTwoFactor();
  const [useRecovery, setUseRecovery] = useState(false);

  async function send(input: { code?: string; recoveryCode?: string }) {
    try {
      await complete.mutateAsync({ challengeToken, ...input });
    } catch (error) {
      if (toApiClientError(error).code === "two_factor_expired") onExpired();
      throw error;
    }
  }

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Two-step sign-in</h1>
      <p className="text-muted mt-2">
        {useRecovery
          ? "Enter one of the recovery codes you saved. Each one works once."
          : "Open your authenticator app and enter the code it shows for Tessel."}
      </p>

      {useRecovery ? (
        <RecoveryForm onSubmit={(recoveryCode) => send({ recoveryCode })} />
      ) : (
        <CodeForm
          label="Authenticator code"
          submitLabel="Log in"
          onSubmit={(code) => send({ code })}
        />
      )}

      <div className="mt-8 flex flex-wrap gap-2 text-sm">
        <Button variant="ghost" size="sm" onClick={() => setUseRecovery((value) => !value)}>
          {useRecovery ? "Use your authenticator app" : "Use a recovery code"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onExpired}>
          Back to log in
        </Button>
      </div>
    </>
  );
}

function RecoveryForm({ onSubmit }: { onSubmit: (code: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      noValidate
      className="mt-8 flex flex-col gap-5"
      onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        if (value.trim().length < 8) {
          setError("Enter a recovery code, like k3vq8-2mtx9");
          return;
        }
        setSubmitting(true);
        setError(undefined);
        try {
          await onSubmit(value.trim());
        } catch (caught) {
          setError(toApiClientError(caught).message);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <FormError message={error} />
      <TextField
        label="Recovery code"
        autoFocus
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="submit" loading={submitting}>
        Log in
      </Button>
    </form>
  );
}
