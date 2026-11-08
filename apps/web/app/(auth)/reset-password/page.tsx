"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { passwordSchema } from "@tessel/contracts";
import { Button, TextField } from "@tessel/ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FormError } from "@/components/form-error";
import { useResetPassword } from "@/hooks/use-auth";
import { applyApiError } from "@/lib/form-errors";

const formSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((value) => value.password === value.confirm, {
    message: "The passwords don't match",
    path: ["confirm"],
  });

export default function ResetPasswordPage() {
  const token = useSearchParams().get("token") ?? "";
  const reset = useResetPassword();
  const [done, setDone] = useState(false);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    try {
      await reset.mutateAsync({ token, password });
      setDone(true);
    } catch (error) {
      applyApiError(error, form.setError, ["password"]);
    }
  });

  if (done) {
    return (
      <>
        <h1 className="text-3xl font-semibold tracking-tight">Password changed</h1>
        <p className="text-muted mt-2" role="status">
          You&apos;ve been signed out on every device. Log in with your new password.
        </p>
        <Link
          href="/login"
          className="bg-accent text-accent-ink hover:bg-accent-strong mt-8 inline-flex h-11 items-center justify-center rounded-lg px-4 font-medium"
        >
          Log in
        </Link>
      </>
    );
  }

  if (!token) {
    return (
      <>
        <h1 className="text-3xl font-semibold tracking-tight">This link is incomplete</h1>
        <p className="text-muted mt-2">Open the link from the email again, or ask for a new one.</p>
        <p className="mt-8">
          <Link
            href="/forgot-password"
            className="text-accent font-medium underline-offset-4 hover:underline"
          >
            Send a new link
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="text-muted mt-2">This signs you out everywhere else.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <FormError message={errors.root?.server?.message} />
        {errors.root?.server ? (
          <Link
            href="/forgot-password"
            className="text-accent -mt-2 w-fit text-sm font-medium underline-offset-4 hover:underline"
          >
            Send a new link
          </Link>
        ) : null}
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters."
          error={errors.password?.message}
          {...form.register("password")}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...form.register("confirm")}
        />
        <Button type="submit" loading={isSubmitting} className="mt-1">
          Change password
        </Button>
      </form>
    </>
  );
}
