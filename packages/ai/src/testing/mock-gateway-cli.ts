import { startMockGateway } from "./mock-gateway";

// Runs the mock gateway for local development and end-to-end tests:
//   AI_GATEWAY_URL=http://127.0.0.1:4300/v1 AI_GATEWAY_API_KEY=mock
const port = Number(process.env.MOCK_GATEWAY_PORT ?? 4300);
const gateway = await startMockGateway({ port });
process.stdout.write(`Mock AI gateway listening at ${gateway.url}\n`);

const stop = () => void gateway.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
