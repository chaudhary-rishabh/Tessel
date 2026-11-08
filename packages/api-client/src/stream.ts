import {
  apiErrorSchema,
  chatEventSchema,
  type ChatEvent,
  type SendMessageRequest,
  type ToolDecisionRequest,
} from "@tessel/contracts";
import { createParser } from "eventsource-parser";
import type { ApiClient } from "./client";
import { ApiClientError } from "./errors";

export interface StreamChatOptions {
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
}

async function toError(response: Response): Promise<ApiClientError> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, requestId, details } = parsed.data.error;
    return new ApiClientError(response.status, code, message, requestId, details);
  }
  return new ApiClientError(
    response.status,
    "unexpected_response",
    `The server responded with an unexpected error (${response.status}).`,
  );
}

/**
 * Reads chat replies as server-sent events. axios can't stream response
 * bodies in the browser, so this uses fetch, with the same token handling:
 * one refresh and retry on a 401.
 */
export function createChatStream(client: ApiClient) {
  async function post(path: string, body: unknown, signal?: AbortSignal) {
    const token = client.getAccessToken();
    return fetch(`${client.baseURL}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  }

  async function stream(
    path: string,
    body: unknown,
    { signal, onEvent }: StreamChatOptions,
  ): Promise<void> {
    let response: Response;
    try {
      response = await post(path, body, signal);
      if (response.status === 401) {
        try {
          await client.refreshSession();
        } catch (error) {
          if (error instanceof ApiClientError && error.status === 401) client.onSessionExpired();
          throw error;
        }
        response = await post(path, body, signal);
      }
    } catch (error) {
      if (signal?.aborted || error instanceof ApiClientError) throw error;
      throw new ApiClientError(
        0,
        "network_error",
        "Can't reach Tessel. Check your connection and try again.",
      );
    }
    if (!response.ok || !response.body) throw await toError(response);

    const parser = createParser({
      onEvent: (message) => {
        const event = chatEventSchema.safeParse(JSON.parse(message.data));
        if (event.success) onEvent(event.data);
      },
    });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(value);
    }
  }

  return {
    /** Sends a message and streams the reply. */
    send: (workspaceId: string, body: SendMessageRequest, options: StreamChatOptions) =>
      stream(`/workspaces/${workspaceId}/chat`, body, options),
    /**
     * Approves or declines a tool call a reply is waiting on, and streams the
     * rest of the reply, starting with a "resume" event.
     */
    decide: (
      workspaceId: string,
      threadId: string,
      callId: string,
      approved: boolean,
      options: StreamChatOptions,
    ) =>
      stream(
        `/workspaces/${workspaceId}/threads/${threadId}/tool-calls/${encodeURIComponent(callId)}/decision`,
        { approved } satisfies ToolDecisionRequest,
        options,
      ),
  };
}
