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

/**
 * The AI provider refused the model for billing reasons: the gateway account
 * has no credits, or is on a free tier that doesn't include this model.
 */
export class ModelNeedsCreditsError extends AiError {
  constructor(modelId: string, cause: unknown) {
    super(
      402,
      "model_needs_credits",
      "This model isn't included in the AI plan on this server. Pick another model",
      { model: modelId },
    );
    this.cause = cause;
  }
}

const CREDITS_REFUSAL = /credit|free tier|top.?up|insufficient (funds|balance|quota)|billing/i;

/** Whether a provider error (or one it wraps) says the account can't pay for the model. */
export function isCreditsRefusal(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const status = (current as { status?: unknown }).status;
    const message = current instanceof Error ? current.message : String(current);
    if ((status === 402 || status === 403) && CREDITS_REFUSAL.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class ModelUnavailableError extends AiError {
  constructor(modelId: string, cause: unknown) {
    super(502, "model_unavailable", "The model couldn't be reached. Try again in a moment", {
      model: modelId,
    });
    this.cause = cause;
  }
}
