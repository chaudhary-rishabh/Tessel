import { fileURLToPath } from "node:url";
import { cli, ServerOptions } from "@livekit/agents";
import { VOICE_AGENT_NAME } from "@tessel/contracts";
import { loadEnv } from "./env";

const env = loadEnv();

// In development tsx runs the TypeScript; the built server loads the bundled job file.
const agentFile = new URL(
  import.meta.url.endsWith(".ts") ? "./agent.ts" : "./agent.mjs",
  import.meta.url,
);

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(agentFile),
    agentName: VOICE_AGENT_NAME,
    wsURL: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    numIdleProcesses: env.VOICE_IDLE_PROCESSES,
    // Load is this agent's calls against its capacity, not the host's CPU: on a
    // host shared with the API and databases, busy CPU would otherwise make
    // LiveKit stop sending calls here. Full at capacity.
    loadFunc: async (server) =>
      Math.min(1, server.activeJobs.length / env.VOICE_MAX_CONCURRENT_CALLS),
    loadThreshold: 1,
    host: "0.0.0.0",
    port: env.VOICE_HEALTH_PORT,
    production: env.NODE_ENV === "production",
  }),
);
