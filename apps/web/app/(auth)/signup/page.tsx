"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { signupRequestSchema } from "@tessel/contracts";
import { Button, TextField } from "@tessel/ui";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { CodeForm } from "@/components/auth/code-form";
import { FormError } from "@/components/form-error";
import { useResendSignup, useSignup, useVerifySignup } from "@/hooks/use-auth";
import { applyApiError } from "@/lib/form-errors";

export default function SignupPage() {
  const signup = useSignup();
  const [pending, setPending] = useState<{ challengeId: string; email: string } | null>(null);
  const form = useForm({
    resolver: zodResolver(signupRequestSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { challengeId } = await signup.mutateAsync(values);
      setPending({ challengeId, email: values.email.trim() });
    } catch (error) {
      applyApiError(error, form.setError, ["name", "email", "password"]);
    }
  });

  if (pending) {
    return <VerifyEmail {...pending} onBack={() => setPending(null)} />;
  }

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
      <p className="text-muted mt-2">You&apos;ll get a personal workspace to start in.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <FormError message={errors.root?.server?.message} />
        <TextField
          label="Name"
          autoComplete="name"
          error={errors.name?.message}
          {...form.register("name")}
        />
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
          Continue
        </Button>
      </form>

      <p className="text-muted mt-8">
        Already have an account?{" "}
        <Link href="/login" className="text-accent font-medium underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}

function VerifyEmail({
  challengeId,
  email,
  onBack,
}: {
  challengeId: string;
  email: string;
  onBack: () => void;
}) {
  const verify = useVerifySignup();
  const resend = useResendSignup();
  const [resent, setResent] = useState(false);

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Check your email</h1>
      <p className="text-muted mt-2">
        We sent a 6-digit code to <span className="text-ink font-medium">{email}</span>. Enter it to
        finish creating your account.
      </p>

      <CodeForm
        label="Code from your email"
        submitLabel="Create account"
        onSubmit={(code) => verify.mutateAsync({ challengeId, code })}
      />

      <div className="text-muted mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span role="status">{resent ? "We sent a new code." : "No email after a minute?"}</span>
        <Button
          variant="ghost"
          size="sm"
          loading={resend.isPending}
          onClick={async () => {
            await resend.mutateAsync(challengeId).catch(() => undefined);
            setResent(true);
          }}
        >
          Send a new code
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Use a different email
        </Button>
      </div>
    </>
  );
}
