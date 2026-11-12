"use client";

import { toApiClientError } from "@tessel/api-client";
import { Button, Spinner } from "@tessel/ui";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { FormError } from "@/components/form-error";
import { useResendEmailVerification, useVerifyEmail } from "@/hooks/use-auth";
import { useSessionStore } from "@/lib/session-store";

/** Where the "confirm your email" link lands. Signed-in only, so the link can't confirm someone else's account. */
export default function VerifyEmailPage() {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-12">
      <Suspense fallback={<Spinner label="Loading" />}>
        <VerifyEmail />
      </Suspense>
    </div>
  );
}

function VerifyEmail() {
  const token = useSearchParams().get("token");
  const verify = useVerifyEmail();
  const resend = useResendEmailVerification();
  const user = useSessionStore((state) => state.user);
  const started = useRef(false);

  useEffect(() => {
    // Once, even when React runs effects twice in development.
    if (started.current || !token || user?.emailVerified) return;
    started.current = true;
    verify.mutate(token);
  }, [token, user?.emailVerified, verify]);

  if (user?.emailVerified) {
    return (
      <div className="flex flex-col items-start gap-4">
        <CircleCheck aria-hidden="true" className="text-accent size-10" />
        <h1 className="text-3xl font-semibold tracking-tight">Your email is confirmed</h1>
        <p className="text-muted">
          You can join your team&apos;s workspaces with{" "}
          <span className="text-ink">{user.email}</span>.
        </p>
        <Button asChild>
          <Link href="/chat">Go to chat</Link>
        </Button>
      </div>
    );
  }

  if (verify.isPending || (token && verify.isIdle)) {
    return <Spinner label="Confirming your email" />;
  }

  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">This link didn&apos;t work</h1>
      <FormError
        message={
          verify.error
            ? toApiClientError(verify.error).message
            : "The link is missing its code. Use the newest link from your email."
        }
      />
      {resend.isSuccess ? (
        <p role="status" className="text-muted">
          We sent a new link to {user?.email}.
        </p>
      ) : (
        <Button loading={resend.isPending} onClick={() => resend.mutate()}>
          Send a new link
        </Button>
      )}
    </div>
  );
}
