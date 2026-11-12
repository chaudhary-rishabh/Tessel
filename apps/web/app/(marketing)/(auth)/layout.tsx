import type { ReactNode } from "react";
import { AuthModal } from "@/components/marketing/auth-modal";
import { Home } from "@/components/marketing/home";

/** The account pages open as a modal over the home page. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Home />
      <AuthModal>{children}</AuthModal>
    </>
  );
}
