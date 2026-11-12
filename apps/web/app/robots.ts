import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/** The public site is open to search engines; the signed-in app isn't. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/chat",
        "/documents",
        "/connectors",
        "/skills",
        "/members",
        "/settings",
        "/invite/",
        "/oauth/",
        "/forgot-password",
        "/reset-password",
      ],
    },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
