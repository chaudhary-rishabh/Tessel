/** Ledger costs are billionths of a dollar. */
export function dollars(nanoUsd: number): string {
  const value = nanoUsd / 1e9;
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  });
}

export const count = (value: number) => value.toLocaleString();

export function dateTime(iso: string | null, fallback = "Never"): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : fallback;
}

export function date(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
