import * as openai from "@livekit/agents-plugin-openai";

type ChatParams = Parameters<openai.LLM["chat"]>[0];

/**
 * A chat model through the AI gateway's OpenAI-compatible endpoint, with the
 * gateway's prompt caching on and, for models that reason, the lightest
 * reasoning effort: a spoken reply can't wait for long thinking. Every turn
 * of one conversation carries the same session affinity, so the gateway
 * sends it to the provider that already holds its cached prompt; the
 * conversation grows by a turn at a time, so most of each request is cached.
 */
export class GatewayLLM extends openai.LLM {
  readonly #extra: Record<string, unknown>;

  constructor({
    apiKey,
    baseURL,
    modelId,
    reasons,
    sessionId,
  }: {
    apiKey: string;
    baseURL: string;
    modelId: string;
    /** Whether the model reasons (its registry capabilities include `reasoning`). */
    reasons: boolean;
    /** Keeps a conversation on one provider, for prompt-cache hits (the chat's thread ID). */
    sessionId?: string;
  }) {
    super({
      model: modelId,
      apiKey,
      baseURL,
      // Spoken replies are short; this also bounds a runaway answer's cost.
      maxCompletionTokens: 1024,
    });
    this.#extra = {
      providerOptions: { gateway: { caching: "auto" } },
      ...(reasons ? { reasoning: { effort: "low" } } : {}),
      // Sent as request headers, not in the body.
      ...(sessionId ? { extra_headers: { "x-session-affinity": sessionId } } : {}),
    };
  }

  override chat(params: ChatParams) {
    return super.chat({ ...params, extraKwargs: { ...this.#extra, ...params.extraKwargs } });
  }
}
