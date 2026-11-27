/**
 * Retrieval metrics over ranked lists of IDs (passages, documents). Gold
 * labels are a set of relevant IDs, or graded relevance (0 to 3) for nDCG.
 */

const top = (ranked: readonly string[], k: number) => ranked.slice(0, Math.max(0, k));

/** Share of the relevant items that appear in the top k. 1 when nothing is relevant. */
export function recallAtK(
  ranked: readonly string[],
  relevant: Iterable<string>,
  k: number,
): number {
  const gold = new Set(relevant);
  if (gold.size === 0) return 1;
  const found = new Set(top(ranked, k).filter((id) => gold.has(id)));
  return found.size / gold.size;
}

/** Share of the top k that is relevant. 0 for an empty list. */
export function precisionAtK(
  ranked: readonly string[],
  relevant: Iterable<string>,
  k: number,
): number {
  const gold = new Set(relevant);
  const head = top(ranked, k);
  if (head.length === 0) return gold.size === 0 ? 1 : 0;
  return head.filter((id) => gold.has(id)).length / head.length;
}

/** 1 when any relevant item is in the top k. */
export function hitAtK(ranked: readonly string[], relevant: Iterable<string>, k: number): number {
  const gold = new Set(relevant);
  if (gold.size === 0) return 1;
  return top(ranked, k).some((id) => gold.has(id)) ? 1 : 0;
}

/** 1 / rank of the first relevant item, 0 when none is ranked. */
export function reciprocalRank(ranked: readonly string[], relevant: Iterable<string>): number {
  const gold = new Set(relevant);
  if (gold.size === 0) return 1;
  const position = ranked.findIndex((id) => gold.has(id));
  return position === -1 ? 0 : 1 / (position + 1);
}

/**
 * Normalized discounted cumulative gain at k, with graded relevance
 * (unlisted IDs are 0). 1 when the list is in the ideal order.
 */
export function ndcgAtK(
  ranked: readonly string[],
  relevance: Readonly<Record<string, number>>,
  k: number,
): number {
  const gain = (grade: number, position: number) => (2 ** grade - 1) / Math.log2(position + 2);
  const dcg = top(ranked, k).reduce(
    (sum, id, position) => sum + gain(relevance[id] ?? 0, position),
    0,
  );
  const ideal = Object.values(relevance)
    .filter((grade) => grade > 0)
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((sum, grade, position) => sum + gain(grade, position), 0);
  if (ideal === 0) return 1;
  return dcg / ideal;
}

/**
 * Citation quality for an answer that cites sources: precision is the share
 * of cited sources that are relevant, recall the share of relevant
 * retrieved sources that were cited.
 */
export function citationScores(
  cited: readonly string[],
  retrieved: readonly string[],
  relevant: Iterable<string>,
): { precision: number; recall: number } {
  const gold = new Set(relevant);
  const citable = retrieved.filter((id) => gold.has(id));
  const precision =
    cited.length === 0
      ? citable.length === 0
        ? 1
        : 0
      : cited.filter((id) => gold.has(id)).length / cited.length;
  const recall =
    citable.length === 0 ? 1 : citable.filter((id) => cited.includes(id)).length / citable.length;
  return { precision, recall };
}
