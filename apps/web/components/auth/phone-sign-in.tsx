"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { phoneCodeRequestSchema } from "@tessel/contracts";
import { Button, TextField } from "@tessel/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormError } from "@/components/form-error";
import { useStartPhoneSignIn, useVerifyPhoneSignIn } from "@/hooks/use-auth";
import { applyApiError } from "@/lib/form-errors";
import { CodeForm } from "./code-form";

/** Log in with a code texted to the number on the account. */
export function PhoneSignIn({ onTwoFactor }: { onTwoFactor: (token: string) => void }) {
  const start = useStartPhoneSignIn();
  const verify = useVerifyPhoneSignIn();
  const [sent, setSent] = useState<{ challengeId: string; phone: string } | null>(null);
  const form = useForm({
    resolver: zodResolver(phoneCodeRequestSchema),
    defaultValues: { phone: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ phone }) => {
    try {
      const { challengeId } = await start.mutateAsync(phone);
      setSent({ challengeId, phone });
    } catch (error) {
      applyApiError(error, form.setError, ["phone"]);
    }
  });

  if (sent) {
    return (
      <>
        <p className="text-muted mt-8" role="status">
          If <span className="text-ink font-medium">{sent.phone}</span> is on a Tessel account,
          we&apos;ve texted it a 6-digit code.
        </p>
        <CodeForm
          className="mt-5"
          label="Code from the text message"
          submitLabel="Log in"
          onSubmit={async (code) => {
            const result = await verify.mutateAsync({ challengeId: sent.challengeId, code });
            if ("challengeToken" in result) onTwoFactor(result.challengeToken);
          }}
        />
        <Button variant="ghost" size="sm" className="mt-3 self-start" onClick={() => setSent(null)}>
          Use a different number
        </Button>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
      <FormError message={errors.root?.server?.message} />
      <TextField
        label="Mobile number"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        placeholder="+91 98765 43210"
        hint="Include the country code. Add a number in Settings to log in this way."
        error={errors.phone?.message}
        {...form.register("phone")}
      />
      <Button type="submit" loading={isSubmitting} className="mt-1">
        Text me a code
      </Button>
    </form>
  );
}
