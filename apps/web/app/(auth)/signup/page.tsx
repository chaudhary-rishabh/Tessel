"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { signupRequestSchema } from "@tessel/contracts";
import { Button, TextField } from "@tessel/ui";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { FormError } from "@/components/form-error";
import { useSignup } from "@/hooks/use-auth";
import { applyApiError } from "@/lib/form-errors";

export default function SignupPage() {
  const signup = useSignup();
  const form = useForm({
    resolver: zodResolver(signupRequestSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signup.mutateAsync(values);
    } catch (error) {
      applyApiError(error, form.setError, ["name", "email", "password"]);
    }
  });

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
          Create account
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
