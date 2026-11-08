import { cn } from "@tessel/ui";

// Mostly greens, with ochre and iris as occasional accents.
const TILE_COLORS = [
  "fill-tile-verdigris stroke-tile-verdigris",
  "fill-tile-verdigris stroke-tile-verdigris",
  "fill-tile-verdigris stroke-tile-verdigris",
  "fill-tile-deep stroke-tile-deep",
  "fill-tile-deep stroke-tile-deep",
  "fill-tile-deep stroke-tile-deep",
  "fill-tile-moss stroke-tile-moss",
  "fill-tile-moss stroke-tile-moss",
  "fill-tile-moss stroke-tile-moss",
  "fill-tile-ochre stroke-tile-ochre",
  "fill-tile-iris stroke-tile-iris",
] as const;

const CELL = 120;
const COLUMNS = 6;
const ROWS = 9;

const TILES = [
  "M0 0h16v8l-8 8H0z",
  "M16 0h16v16h-8l-8-8z",
  "M0 16h8l8 8v8H0z",
  "M24 16h8v16H16v-8z",
] as const;

/** Picks a tile color from its position, so server and browser draw the same picture. */
function colorAt(row: number, column: number, tile: number): string {
  const index = (row * 7 + column * 13 + tile * 5 + row * column) % TILE_COLORS.length;
  return TILE_COLORS[index] ?? TILE_COLORS[0];
}

/** The four interlocking tiles of the Tessel mark, at one cell position. */
function Cell({ row, column }: { row: number; column: number }) {
  const diamond =
    (row + column) % 3 === 0
      ? "fill-tile-ink stroke-tile-ink"
      : "fill-tile-paper stroke-tile-paper";
  return (
    <g
      transform={`translate(${column * CELL} ${row * CELL}) scale(${CELL / 32})`}
      strokeWidth={0.35}
      strokeLinejoin="round"
    >
      {TILES.map((d, tile) => (
        <path key={d} d={d} className={colorAt(row, column, tile)} />
      ))}
      <path d="M8 16l8-8 8 8-8 8z" className={diamond} />
    </g>
  );
}

/** A field of Tessel tiles, used as the visual on the landing and sign-in pages. */
export function Tessellation({ className }: { className?: string }) {
  const cells = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      cells.push(<Cell key={`${row}-${column}`} row={row} column={column} />);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${COLUMNS * CELL} ${ROWS * CELL}`}
      preserveAspectRatio="xMidYMid slice"
      className={cn("bg-tile-verdigris block", className)}
      aria-hidden="true"
    >
      {cells}
    </svg>
  );
}
