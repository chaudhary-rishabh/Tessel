import { startMockMcpServer } from "./mock-server";

// Runs an OAuth-protected mock GitHub MCP server for local development and
// end-to-end tests: GITHUB_MCP_URL=http://127.0.0.1:4400/mcp
const port = Number(process.env.MOCK_MCP_PORT ?? 4400);
const server = await startMockMcpServer({
  port,
  auth: process.env.MOCK_MCP_AUTH === "token" ? "token" : "oauth",
});
process.stdout.write(`Mock MCP server listening at ${server.url}\n`);

const stop = () => void server.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
