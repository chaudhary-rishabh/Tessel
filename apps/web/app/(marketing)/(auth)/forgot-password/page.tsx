"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordRequestSchema } from "@tessel/contracts";
import { Button, TextField } from "@tessel/ui";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormError } from "@/components/form-error";
import { useForgotPassword } from "@/hooks/use-auth";
import { applyApiError } from "@/lib/form-errors";

export default function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(forgotPasswordRequestSchema),
    defaultValues: { email: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    try {
      await forgot.mutateAsync(email);
      setSentTo(email);
    } catch (error) {
      applyApiError(error, form.setError, ["email"]);
    }
  });

  if (sentTo) {
    return (
      <>
        <h1 className="text-[1.65rem] leading-tight font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="text-muted mt-2" role="status">
          If <span className="text-ink font-medium">{sentTo}</span> has a Tessel account, a link to
          reset the password is on its way. It works once, for 30 minutes.
        </p>
        <p className="text-muted mt-8">
          <Link
            href="/login"
            className="text-accent font-medium underline-offset-4 hover:underline"
          >
            Back to log in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-[1.65rem] leading-tight font-semibold tracking-tight">
        Reset your password
      </h1>
      <p className="text-muted mt-2">Enter your account&apos;s email and we&apos;ll send a link.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <FormError message={errors.root?.server?.message} />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message}
          {...form.register("email")}
        />
        <Button type="submit" loading={isSubmitting} className="mt-1">
          Send reset link
        </Button>
      </form>

      <p className="text-muted mt-8">
        Remembered it?{" "}
        <Link href="/login" className="text-accent font-medium underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
