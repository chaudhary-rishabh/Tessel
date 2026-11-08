/**
 * Sparse (keyword) vectors for hybrid search. Terms are hashed to indices and
 * weighted by a saturated term frequency; Qdrant applies inverse document
 * frequency itself (the sparse vector is configured with the IDF modifier),
 * which together gives BM25-style keyword scoring.
 */
export interface SparseVector {
  indices: number[];
  values: number[];
}

const STOP_WORDS = new Set(
  (
    "a an and are as at be but by for from has have he her his i if in into is it its me my no not of on or our " +
    "she so that the their them there these they this to was we were what when which who will with you your"
  ).split(" "),
);

/** Lowercased word tokens in any script (with combining marks), without stop words. */
export function tokenize(text: string): string[] {
  const words =
    text
      .toLowerCase()
      .normalize("NFKC")
      .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}_'-]*/gu) ?? [];
  return words
    .map((word) => word.replace(/['-]+$/u, ""))
    .filter((word) => word.length > 1 && word.length <= 40 && !STOP_WORDS.has(word));
}

/** 32-bit FNV-1a, so the same term always maps to the same index. */
function hashTerm(term: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(term)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const K1 = 1.2;

export function sparseVector(text: string): SparseVector {
  const counts = new Map<number, number>();
  for (const term of tokenize(text)) {
    const index = hashTerm(term);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  const indices = [...counts.keys()].sort((a, b) => a - b);
  // BM25's term-frequency saturation: repeating a word helps less each time.
  const values = indices.map((index) => {
    const frequency = counts.get(index)!;
    return (frequency * (K1 + 1)) / (frequency + K1);
  });
  return { indices, values };
}
