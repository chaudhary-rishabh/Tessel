"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { loginRequestSchema } from "@tessel/contracts";
import { Button, TextField } from "@tessel/ui";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { FormError } from "@/components/form-error";
import { useLogin } from "@/hooks/use-auth";
import { applyApiError } from "@/lib/form-errors";

export default function LoginPage() {
  const login = useLogin();
  const form = useForm({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
    } catch (error) {
      applyApiError(error, form.setError, ["email", "password"]);
    }
  });

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Log in to Tessel</h1>
      <p className="text-muted mt-2">Welcome back. Pick up where your team left off.</p>

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
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register("password")}
        />
        <Button type="submit" loading={isSubmitting} className="mt-1">
          Log in
        </Button>
      </form>

      <p className="text-muted mt-8">
        New to Tessel?{" "}
        <Link href="/signup" className="text-accent font-medium underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
