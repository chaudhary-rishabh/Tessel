/** Friendly text for chat error codes, including ones saved on old messages. */
const MESSAGES: Record<string, string> = {
  content_blocked: "This message can't be sent because it breaks the usage policy.",
  daily_cost_cap_reached: "You've reached today's AI usage limit. It resets at midnight UTC.",
  model_unavailable: "The model couldn't finish this reply. Try again.",
  model_cannot_read_images:
    "This model can't read images. Pick a model that can, or remove the image.",
  model_not_found: "That model isn't available any more. Pick another one.",
  ai_not_configured: "AI isn't set up on this server yet.",
  moderation_unavailable: "Messages can't be checked right now. Try again in a moment.",
  rate_limited: "You're sending messages too quickly. Wait a moment and try again.",
  reply_blocked: "This reply was removed because it broke the usage policy.",
  approval_not_pending: "This action was already decided or cancelled.",
  network_error: "Can't reach Tessel. Check your connection and try again.",
};

export function chatErrorMessage(code: string | null | undefined, fallback?: string): string {
  return (code && MESSAGES[code]) ?? fallback ?? "Something went wrong with this reply.";
}
