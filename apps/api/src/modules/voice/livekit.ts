import { VOICE_AGENT_NAME, type VoiceDispatchMetadata } from "@tessel/contracts";
import {
  AccessToken,
  RoomAgentDispatch,
  RoomConfiguration,
  RoomServiceClient,
  TrackSource,
} from "livekit-server-sdk";

/** How the API reaches LiveKit: room tokens for browsers, and ending rooms. */
export interface VoiceRooms {
  /** The address browsers connect to (wss://…). */
  publicUrl: string;
  /**
   * A token that lets one user into one room with their microphone, and asks
   * LiveKit to send the voice agent with the session's ID.
   */
  issueToken(input: {
    roomName: string;
    userId: string;
    userName: string;
    dispatch: VoiceDispatchMetadata;
  }): Promise<string>;
  /** Ends a room for everyone in it. Missing rooms are fine. */
  closeRoom(roomName: string): Promise<void>;
}

export interface LiveKitSettings {
  /** Where the API reaches the server (http://livekit:7880 on the host). */
  url: string;
  publicUrl: string;
  apiKey: string;
  apiSecret: string;
}

/** Long enough to join; LiveKit refreshes the token once the browser is connected. */
const JOIN_TOKEN_TTL = "10m";

export function createLiveKitRooms(settings: LiveKitSettings): VoiceRooms {
  const rooms = new RoomServiceClient(settings.url, settings.apiKey, settings.apiSecret);
  return {
    publicUrl: settings.publicUrl,
    async issueToken({ roomName, userId, userName, dispatch }) {
      const token = new AccessToken(settings.apiKey, settings.apiSecret, {
        identity: `user-${userId}`,
        name: userName,
        ttl: JOIN_TOKEN_TTL,
      });
      token.addGrant({
        room: roomName,
        roomJoin: true,
        // The browser only ever sends its microphone; everything else comes from the agent.
        canPublish: true,
        canPublishSources: [TrackSource.MICROPHONE],
        canSubscribe: true,
        canPublishData: true,
      });
      token.roomConfig = new RoomConfiguration({
        name: roomName,
        // The user and the agent. Nobody else joins a voice conversation.
        maxParticipants: 2,
        // Close the room shortly after the user leaves, which ends the agent's job.
        departureTimeout: 5,
        emptyTimeout: 60,
        agents: [
          new RoomAgentDispatch({
            agentName: VOICE_AGENT_NAME,
            metadata: JSON.stringify(dispatch),
          }),
        ],
      });
      return token.toJwt();
    },
    async closeRoom(roomName) {
      try {
        await rooms.deleteRoom(roomName);
      } catch (error) {
        // Already gone: LiveKit answers 404 for rooms that ended on their own.
        if (!/not.?found|404/i.test(String(error))) throw error;
      }
    },
  };
}
