import { startMockOAuthProvider } from "./mock-oauth";

// pnpm mock-oauth: a mock Google and GitHub sign-in for local development and end-to-end tests.
const port = Number(process.env.MOCK_OAUTH_PORT ?? 4500);
const provider = await startMockOAuthProvider({ port });
process.stdout.write(`Mock Google and GitHub sign-in at ${provider.url}\n`);
