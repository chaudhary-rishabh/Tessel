import { z } from "zod";

// NEXT_PUBLIC_ values are inlined at build time, so they must be read directly.
export const env = z.object({ apiUrl: z.url(), mcpUrl: z.url() }).parse({
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  // Where outside MCP clients connect, shown with personal access tokens.
  mcpUrl: process.env.NEXT_PUBLIC_MCP_URL ?? "http://localhost:4100/mcp",
});
