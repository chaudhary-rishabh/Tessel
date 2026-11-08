"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSignInOptions } from "@tessel/api-client/react";
import { loginRequestSchema } from "@tessel/contracts";
import { Button, TextField } from "@tessel/ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { PhoneSignIn } from "@/components/auth/phone-sign-in";
import { SOCIAL_ERRORS, SocialButtons } from "@/components/auth/social-buttons";
import { TwoFactorStep } from "@/components/auth/two-factor-step";
import { FormError } from "@/components/form-error";
import { useLogin } from "@/hooks/use-auth";
import { applyApiError, safeNextPath } from "@/lib/form-errors";

export default function LoginPage() {
  const params = useSearchParams();
  const next = params.get("next") ? safeNextPath(params.get("next")) : undefined;
  const socialError = SOCIAL_ERRORS[params.get("error") ?? ""];
  const options = useSignInOptions();
  const [mode, setMode] = useState<"password" | "phone">("password");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  if (challengeToken) {
    return (
      <TwoFactorStep challengeToken={challengeToken} onExpired={() => setChallengeToken(null)} />
    );
  }

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Log in to Tessel</h1>
      <p className="text-muted mt-2">Welcome back. Pick up where your team left off.</p>
      {socialError ? (
        <div className="mt-6">
          <FormError message={socialError} />
        </div>
      ) : null}

      <SocialButtons next={next} />

      {mode === "phone" ? (
        <PhoneSignIn onTwoFactor={setChallengeToken} />
      ) : (
        <PasswordForm onTwoFactor={setChallengeToken} />
      )}

      {options.data?.phone ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 self-start"
          onClick={() => setMode(mode === "phone" ? "password" : "phone")}
        >
          {mode === "phone" ? "Use email and password instead" : "Use a text message instead"}
        </Button>
      ) : null}

      <p className="text-muted mt-8">
        New to Tessel?{" "}
        <Link href="/signup" className="text-accent font-medium underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}

function PasswordForm({ onTwoFactor }: { onTwoFactor: (token: string) => void }) {
  const login = useLogin();
  const form = useForm({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await login.mutateAsync(values);
      if ("challengeToken" in result) onTwoFactor(result.challengeToken);
    } catch (error) {
      applyApiError(error, form.setError, ["email", "password"]);
    }
  });

  return (
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
      <div className="flex flex-col gap-1.5">
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register("password")}
        />
        <Link
          href="/forgot-password"
          className="text-accent w-fit text-sm font-medium underline-offset-4 hover:underline"
        >
          Forgot password?
        </Link>
      </div>
      <Button type="submit" loading={isSubmitting} className="mt-1">
        Log in
      </Button>
    </form>
  );
}
