/**
 * Whether a message looks like a multi-part task that Plan (steps done one
 * after another) or Team (specialists for different kinds of work) would
 * handle better than a single answer. Only a suggestion: nothing switches on
 * its own.
 */
export function suggestMode(text: string): "plan" | "team" | null {
  const trimmed = text.trim();
  if (trimmed.length < 60) return null;
  const listItems = trimmed.match(/^\s*(?:\d+[.)]|[-*•])\s+\S/gm)?.length ?? 0;
  const sequence =
    trimmed.match(/\b(?:first|then|after that|next|finally|step \d+)\b/gi)?.length ?? 0;
  const asks = trimmed.match(/[^.!?\n]+[?]|\b(?:and also|as well as|plus)\b/gi)?.length ?? 0;
  // Different kinds of work in one request: research, numbers, writing, changes.
  const kinds = [
    /\b(?:research|find|look up|search|compare)\b/i,
    /\b(?:calculate|estimate|forecast|budget|how much|percent)\b/i,
    /\b(?:write|draft|summari[sz]e|email|report|memo)\b/i,
    /\b(?:create|update|delete|add|file|open an issue)\b/i,
  ].filter((pattern) => pattern.test(trimmed)).length;

  if (kinds >= 3 && trimmed.length >= 120) return "team";
  if (listItems >= 3 || sequence >= 3 || (asks >= 3 && trimmed.length >= 150)) return "plan";
  return null;
}
