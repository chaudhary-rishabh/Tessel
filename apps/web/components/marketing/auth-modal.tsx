"use client";

import { Modal, Spinner, TesselMark } from "@tessel/ui";
import { useRouter } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { GuestOnly } from "@/components/session-gates";

/**
 * Log in, sign up, and the other account pages, shown as a modal over the
 * home page. Each keeps its own address, so links and redirects like
 * `/login?next=/settings` work as before. Closing the modal goes home.
 */
export function AuthModal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const loading = (
    <div className="text-muted grid min-h-64 place-items-center">
      <Spinner label="Loading" />
    </div>
  );

  return (
    <Modal label="Your Tessel account" onClose={() => router.push("/")}>
      <TesselMark className="size-9" />
      <div className="mt-5 flex flex-col">
        <Suspense fallback={loading}>
          <GuestOnly fallback={loading}>{children}</GuestOnly>
        </Suspense>
      </div>
    </Modal>
  );
}
