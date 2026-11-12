import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Create your account",
  description: "Create a free Tessel account: an AI workspace for your documents and tools.",
  path: "/signup",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
