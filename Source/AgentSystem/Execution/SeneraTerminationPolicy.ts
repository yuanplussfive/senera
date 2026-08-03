export const SeneraDefaultTerminationGraceMs = 2_000;

export function normalizeSeneraTerminationGraceMs(value: number | undefined): number {
  if (value === undefined) return SeneraDefaultTerminationGraceMs;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("terminationGraceMs must be a positive finite number.");
  }
  return Math.max(1, Math.trunc(value));
}
