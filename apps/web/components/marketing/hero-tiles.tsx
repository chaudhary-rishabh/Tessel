import { cn } from "@tessel/ui";
import type { CSSProperties } from "react";

/**
 * The Tessel mark at the size of the page, each tile sitting in cells of the
 * hero's grid: three across the top and two for the stem. `column` counts
 * cells from the middle of the page, `row` from the top.
 */
const TILES = [
  { column: 3, row: 3, width: 2, height: 2, color: "bg-tile-verdigris", from: [-3, -2] },
  {
    column: 5,
    row: 3,
    width: 2,
    height: 2,
    color: "bg-surface border-line dark:bg-tile-paper border dark:border-transparent",
    from: [0, -4],
  },
  { column: 7, row: 3, width: 2, height: 2, color: "bg-tile-ochre", from: [4, -2] },
  { column: 5, row: 5, width: 1, height: 3, color: "bg-tile-iris", from: [-2, 4] },
  { column: 6, row: 5, width: 1, height: 3, color: "bg-tile-moss", from: [3, 3] },
] as const;

/** Decoration for wide screens; the header already carries the mark. */
export function HeroTiles() {
  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10 hidden lg:block">
      {TILES.map((tile, index) => (
        <div
          key={index}
          className="tile-in absolute p-[3px]"
          style={
            {
              left: `calc(50% - 2rem + ${tile.column * 4}rem)`,
              top: `${tile.row * 4}rem`,
              width: `${tile.width * 4}rem`,
              height: `${tile.height * 4}rem`,
              "--from-x": `${tile.from[0]}rem`,
              "--from-y": `${tile.from[1]}rem`,
              "--delay": `${0.1 + index * 0.08}s`,
            } as CSSProperties
          }
        >
          <div className={cn("size-full rounded-[0.9rem]", tile.color)} />
        </div>
      ))}
    </div>
  );
}
