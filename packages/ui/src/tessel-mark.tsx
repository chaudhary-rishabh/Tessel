import { cn } from "./cn";

/**
 * The Tessel mark: four tiles that interlock into one square, the idea of the
 * product (separate pieces of knowledge and tools fitting together).
 */
export function TesselMark({
  className,
  title = "Tessel",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} role="img" aria-label={title}>
      <path d="M2 2h14v8l-6 6H2z" className="fill-tile-verdigris" />
      <path d="M16 2h14v14h-8l-6-6z" className="fill-tile-ochre" />
      <path d="M2 16h8l6 6v8H2z" className="fill-tile-iris" />
      <path d="M22 16h8v14H16v-8z" className="fill-tile-moss" />
      <path d="M10 16l6-6 6 6-6 6z" className="fill-tile-ink dark:fill-tile-paper" />
    </svg>
  );
}
