import type { GraphFactView } from "@tessel/contracts";

export interface Neighbour {
  name: string;
  type: string;
  /** How it connects to the centre: the relation, and which way it points. */
  links: { type: string; outgoing: boolean }[];
}

/** The entities a set of facts connects to `centre`, each with its relations. */
export function neighbourhood(centre: string, facts: GraphFactView[]): Neighbour[] {
  const key = centre.trim().toLowerCase();
  const byName = new Map<string, Neighbour>();
  for (const fact of facts) {
    const outgoing = fact.source.toLowerCase() === key;
    const incoming = fact.target.toLowerCase() === key;
    if (!outgoing && !incoming) continue;
    const name = outgoing ? fact.target : fact.source;
    const neighbour = byName.get(name.toLowerCase()) ?? {
      name,
      type: outgoing ? fact.targetType : fact.sourceType,
      links: [],
    };
    if (!neighbour.links.some((link) => link.type === fact.type && link.outgoing === outgoing)) {
      neighbour.links.push({ type: fact.type, outgoing });
    }
    byName.set(name.toLowerCase(), neighbour);
  }
  return [...byName.values()];
}
