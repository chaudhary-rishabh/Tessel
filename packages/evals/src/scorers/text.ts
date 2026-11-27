/** Text checks that need no model: phrases, patterns, and spoken style. */

const normalize = (text: string) =>
  text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ");

/** Share of the phrases the text contains (case and accent insensitive). */
export function containsAll(text: string, phrases: readonly string[]): number {
  if (phrases.length === 0) return 1;
  const haystack = normalize(text);
  return phrases.filter((phrase) => haystack.includes(normalize(phrase))).length / phrases.length;
}

/** 1 when the text contains none of the phrases, else 0. */
export function containsNone(text: string, phrases: readonly string[]): number {
  const haystack = normalize(text);
  return phrases.some((phrase) => haystack.includes(normalize(phrase))) ? 0 : 1;
}

/** 1 when at least one of the phrases appears. */
export function containsAny(text: string, phrases: readonly string[]): number {
  if (phrases.length === 0) return 1;
  const haystack = normalize(text);
  return phrases.some((phrase) => haystack.includes(normalize(phrase))) ? 1 : 0;
}

/** Sentences, counted by terminal punctuation (a trailing fragment counts as one). */
export function sentenceCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const ends = trimmed.match(/[.!?…]+(?=\s|$)/g)?.length ?? 0;
  return /[.!?…]$/.test(trimmed) ? ends : ends + 1;
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Markup that sounds wrong read aloud. */
const NOT_SPOKEN: { pattern: RegExp; label: string }[] = [
  { pattern: /^\s{0,3}#{1,6}\s/m, label: "heading" },
  { pattern: /^\s*[-*•]\s+\S/m, label: "bullet list" },
  { pattern: /^\s*\d+[.)]\s+\S/m, label: "numbered list" },
  { pattern: /\*\*[^*]+\*\*|__[^_]+__/, label: "bold" },
  { pattern: /```|`[^`]+`/, label: "code" },
  { pattern: /\|.+\|/, label: "table" },
  { pattern: /https?:\/\/|www\./i, label: "link" },
  { pattern: /\[[^\]]+\]\([^)]+\)/, label: "markdown link" },
  { pattern: /\p{Extended_Pictographic}/u, label: "emoji" },
];

/** What in the text wouldn't sound right spoken aloud; empty when it reads cleanly. */
export function unspokenMarkup(text: string): string[] {
  return NOT_SPOKEN.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

/** Inline citation markers like [1] or [2][3], in order of first use. */
export function citationMarkers(text: string): number[] {
  const seen: number[] = [];
  for (const match of text.matchAll(/\[(\d{1,2})\]/g)) {
    const id = Number(match[1]);
    if (!seen.includes(id)) seen.push(id);
  }
  return seen;
}
