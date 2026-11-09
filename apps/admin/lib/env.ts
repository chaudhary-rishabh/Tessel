import { z } from "zod";

// NEXT_PUBLIC_ values are inlined at build time, so they must be read directly.
export const env = z.object({ apiUrl: z.url(), webUrl: z.url() }).parse({
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  // The main app, for links to Settings (two-step sign-in) and back to Tessel.
  webUrl: process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3000",
});
