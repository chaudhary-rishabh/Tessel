import { cn } from "./cn";

/**
 * The Tessel mark: a T built from the four brand tiles on a dark square. The
 * bar is green, white, and ochre; the stem is iris and moss. Separate pieces
 * fitting together into one shape is the idea of the product.
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
      <rect width="32" height="32" rx="7.5" className="fill-tile-ink" />
      <rect x="4.5" y="5" width="6.6" height="8" rx="1.4" className="fill-tile-verdigris" />
      <rect x="12" y="5" width="8" height="8" rx="1.4" className="fill-tile-paper" />
      <rect x="20.9" y="5" width="6.6" height="8" rx="1.4" className="fill-tile-ochre" />
      <rect x="12" y="13.9" width="3.55" height="13.1" rx="1.4" className="fill-tile-iris" />
      <rect x="16.45" y="13.9" width="3.55" height="13.1" rx="1.4" className="fill-tile-moss" />
    </svg>
  );
}
