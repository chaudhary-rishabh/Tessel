import * as openai from "@livekit/agents-plugin-openai";

type ChatParams = Parameters<openai.LLM["chat"]>[0];

/**
 * A chat model through the AI gateway's OpenAI-compatible endpoint, with the
 * gateway's prompt caching on and, for models that reason, the lightest
 * reasoning effort: a spoken reply can't wait for long thinking.
 */
export class GatewayLLM extends openai.LLM {
  readonly #extra: Record<string, unknown>;

  constructor({
    apiKey,
    baseURL,
    modelId,
    reasons,
  }: {
    apiKey: string;
    baseURL: string;
    modelId: string;
    /** Whether the model reasons (its registry capabilities include `reasoning`). */
    reasons: boolean;
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
    };
  }

  override chat(params: ChatParams) {
    return super.chat({ ...params, extraKwargs: { ...this.#extra, ...params.extraKwargs } });
  }
}
