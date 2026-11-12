"use client";

import { Button } from "@tessel/ui";
import { MailCheck, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useResendEmailVerification } from "@/hooks/use-auth";
import { useSessionStore } from "@/lib/session-store";

/** A reminder to confirm the email, until it's confirmed. Can be hidden until the next visit. */
export function EmailReminder() {
  const user = useSessionStore((state) => state.user);
  const pathname = usePathname();
  const resend = useResendEmailVerification();
  const [hidden, setHidden] = useState(false);

  if (!user || user.emailVerified || hidden || pathname === "/verify-email") return null;

  return (
    <div
      role="region"
      aria-label="Confirm your email"
      className="border-line bg-accent/8 flex items-start gap-3 border-b px-4 py-2.5 text-sm sm:items-center"
    >
      <MailCheck aria-hidden="true" className="text-accent mt-0.5 size-4 shrink-0 sm:mt-0" />
      <p className="min-w-0 flex-1">
        {resend.isSuccess ? (
          <span role="status">We sent a new link to {user.email}.</span>
        ) : (
          <>
            Confirm your email to join your team&apos;s workspaces. We sent a link to{" "}
            <span className="font-medium break-all">{user.email}</span>.
          </>
        )}
      </p>
      {resend.isSuccess ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="text-accent shrink-0"
          loading={resend.isPending}
          onClick={() => resend.mutate()}
        >
          Send again
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="-my-2 size-9 shrink-0"
        aria-label="Hide this reminder"
        onClick={() => setHidden(true)}
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
