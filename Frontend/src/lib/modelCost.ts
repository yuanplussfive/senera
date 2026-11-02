/** Preserve small charges without displaying long, misleading precision. */
export function formatModelCost(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
  return `$${value.toLocaleString("en-US", { minimumSignificantDigits: 2, maximumSignificantDigits: 2, useGrouping: false })}`;
}
