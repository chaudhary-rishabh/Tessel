import { PLANS } from "@tessel/contracts";
import type { Metadata } from "next";
import { Home } from "@/components/marketing/home";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: site.title },
  alternates: { canonical: "/" },
};

/** Tells search engines what Tessel is and what it costs. */
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${site.url}/#organization`,
      name: site.name,
      url: site.url,
      logo: `${site.url}/icon-512.png`,
      sameAs: [site.repository],
    },
    {
      "@type": "WebSite",
      "@id": `${site.url}/#website`,
      url: site.url,
      name: site.name,
      publisher: { "@id": `${site.url}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      name: site.name,
      url: site.url,
      description: site.description,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      publisher: { "@id": `${site.url}/#organization` },
      offers: Object.values(PLANS).map((plan) => ({
        "@type": "Offer",
        name: plan.name,
        price: plan.price.usd,
        priceCurrency: "USD",
        url: `${site.url}/pricing`,
      })),
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // JSON from our own constants; "<" is escaped so it can't close the tag.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <Home />
    </>
  );
}
