import type { Metadata } from "next";

/** Public facts about the site, shared by pages, metadata, the sitemap, and structured data. */
export const site = {
  name: "Tessel",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tessel.chat").replace(/\/$/, ""),
  title: "Tessel: the AI workspace for your team's documents and tools",
  description:
    "Chat with AI over your team's documents with cited answers, run agents that ask before they act, and connect GitHub, Notion, and Linear through MCP. One workspace for the whole team.",
  repository: "https://github.com/chaudhary-rishabh/tessel",
  /** Where people write about their account, privacy, or billing. */
  contactEmail: "support@tessel.chat",
} as const;

/** Links in the site header, in order. */
export const navigation = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
] as const;

/** The share card image (app/opengraph-image.png), named again when a page sets its own card. */
const shareImage = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "Tessel: understand everything your team knows.",
};

/** Title, description, canonical address, and share cards for one public page. */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const shareTitle = `${title} · ${site.name}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: shareTitle,
      description,
      url: path,
      siteName: site.name,
      type: "website",
      images: [shareImage],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [shareImage] },
  };
}
