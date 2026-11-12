import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Log in",
  description: "Log in to Tessel to chat with your team's documents and tools.",
  path: "/login",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
