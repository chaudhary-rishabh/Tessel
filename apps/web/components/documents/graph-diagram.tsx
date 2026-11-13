"use client";

import type { GraphFactView } from "@tessel/contracts";
import { cn } from "@tessel/ui";
import { neighbourhood } from "./graph-neighbourhood";

const MAX_NEIGHBOURS = 16;
const RADIUS = 175;
const readable = (type: string) => type.toLowerCase().replace(/_/g, " ");
const short = (text: string, max = 22) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * An entity's neighbourhood as a diagram: the entity in the middle, what it
 * connects to around it, each line labelled with how. Choosing a neighbour
 * moves the diagram to it.
 */
export function GraphDiagram({
  centre,
  facts,
  onPick,
}: {
  centre: string;
  facts: GraphFactView[];
  onPick: (name: string) => void;
}) {
  const all = neighbourhood(centre, facts);
  const shown = all.slice(0, MAX_NEIGHBOURS);
  const centreName =
    facts.find((fact) => fact.source.toLowerCase() === centre.toLowerCase())?.source ??
    facts.find((fact) => fact.target.toLowerCase() === centre.toLowerCase())?.target ??
    centre;
  const at = (index: number) => {
    const angle = (index / shown.length) * 2 * Math.PI - Math.PI / 2;
    return { x: Math.cos(angle) * RADIUS, y: Math.sin(angle) * RADIUS };
  };

  return (
    <figure className="border-line bg-surface mt-3 overflow-hidden rounded-xl border">
      <svg
        viewBox="-280 -235 560 470"
        role="group"
        aria-label={`How ${centreName} connects to ${all.length} other ${all.length === 1 ? "thing" : "things"}`}
        className="block h-auto w-full"
      >
        {shown.map((neighbour, index) => {
          const { x, y } = at(index);
          const label = neighbour.links
            .map((link) => `${link.outgoing ? "" : "← "}${readable(link.type)}`)
            .join(", ");
          return (
            <g key={`edge-${neighbour.name}`} aria-hidden="true">
              <line x1={0} y1={0} x2={x} y2={y} className="stroke-line" strokeWidth={1.5} />
              <text
                x={x * 0.5}
                y={y * 0.5}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-muted text-[10px]"
                paintOrder="stroke"
                stroke="var(--color-surface)"
                strokeWidth={4}
              >
                {short(label, 26)}
              </text>
            </g>
          );
        })}
        {shown.map((neighbour, index) => {
          const { x, y } = at(index);
          return (
            <g
              key={`node-${neighbour.name}`}
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={0}
              aria-label={`${neighbour.name}, ${readable(neighbour.type)}: show its connections`}
              onClick={() => onPick(neighbour.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPick(neighbour.name);
                }
              }}
              className="group cursor-pointer focus:outline-none"
            >
              <circle
                r={9}
                className="fill-paper stroke-muted group-hover:fill-accent/20 group-hover:stroke-accent group-focus-visible:stroke-accent"
                strokeWidth={2}
              />
              <text y={24} textAnchor="middle" className="fill-ink text-[12px] font-medium">
                {short(neighbour.name)}
              </text>
              <text y={38} textAnchor="middle" className="fill-muted text-[10px]">
                {readable(neighbour.type)}
              </text>
            </g>
          );
        })}
        <g aria-hidden="true">
          <circle r={16} className="fill-accent" />
          <text
            y={34}
            textAnchor="middle"
            className="fill-ink text-[14px] font-semibold"
            paintOrder="stroke"
            stroke="var(--color-surface)"
            strokeWidth={4}
          >
            {short(centreName, 28)}
          </text>
        </g>
      </svg>
      {all.length > shown.length ? (
        <figcaption className={cn("text-muted border-line border-t px-3 py-2 text-xs")}>
          Showing {shown.length} of {all.length} connections. The list has them all.
        </figcaption>
      ) : null}
    </figure>
  );
}
