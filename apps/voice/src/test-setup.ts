import { initializeLogger } from "@livekit/agents";

// LiveKit's plugins log through a process-wide logger that has to exist first.
initializeLogger({ pretty: false, level: "warn" });
