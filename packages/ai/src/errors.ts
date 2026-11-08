/**
 * Expected AI errors. Each carries an HTTP status and a stable code, so the
 * API can turn them into error responses without knowing their details.
 */
export class AiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ModelNotFoundError extends AiError {
  constructor(readonly modelId: string) {
    super(400, "model_not_found", `Model "${modelId}" is not available`, { model: modelId });
  }
}

export type SpendScope = "user" | "workspace" | "global";

export class CostCapExceededError extends AiError {
  constructor(
    readonly scope: SpendScope,
    readonly resetsAt: Date,
  ) {
    const who = { user: "your", workspace: "this workspace's", global: "the service's" }[scope];
    super(429, "daily_cost_cap_reached", `You've reached ${who} daily AI usage limit`, {
      scope,
      resetsAt: resetsAt.toISOString(),
    });
  }
}

export class ContentBlockedError extends AiError {
  constructor(readonly categories: string[]) {
    super(422, "content_blocked", "This message can't be sent because it breaks the usage policy", {
      categories,
    });
  }
}

export class AiNotConfiguredError extends AiError {
  constructor() {
    super(503, "ai_not_configured", "AI features are not configured on this server");
  }
}

export class ModelUnavailableError extends AiError {
  constructor(modelId: string, cause: unknown) {
    super(502, "model_unavailable", "The model couldn't be reached. Try again in a moment", {
      model: modelId,
    });
    this.cause = cause;
  }
}
