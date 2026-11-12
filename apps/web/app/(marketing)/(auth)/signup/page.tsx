"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { signupRequestSchema } from "@tessel/contracts";
import { Button, TextField } from "@tessel/ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { SocialButtons } from "@/components/auth/social-buttons";
import { FormError } from "@/components/form-error";
import { useSignup } from "@/hooks/use-auth";
import { applyApiError, safeNextPath } from "@/lib/form-errors";

export default function SignupPage() {
  // Where to go once signed in, such as back to an invitation.
  const nextParam = useSearchParams().get("next");
  const next = nextParam ? safeNextPath(nextParam) : undefined;
  const signup = useSignup();
  const form = useForm({
    resolver: zodResolver(signupRequestSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  // A new session sends the guest gate on to `next` (or chat).
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signup.mutateAsync(values);
    } catch (error) {
      applyApiError(error, form.setError, ["email", "password"]);
    }
  });

  return (
    <>
      <h1 className="text-[1.65rem] leading-tight font-semibold tracking-tight">
        Create your account
      </h1>
      <p className="text-muted mt-2">Free to start. You&apos;ll be in your workspace right away.</p>

      <SocialButtons next={next} />

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
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters."
          error={errors.password?.message}
          {...form.register("password")}
        />
        <Button type="submit" loading={isSubmitting} className="mt-1">
          Create account
        </Button>
      </form>

      <p className="text-muted mt-8">
        Already have an account?{" "}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="text-accent font-medium underline-offset-4 hover:underline"
        >
          Log in
        </Link>
      </p>
    </>
  );
}
