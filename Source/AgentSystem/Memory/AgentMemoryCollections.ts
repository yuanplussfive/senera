export function mergeUnique(left: readonly string[], right: readonly string[]): string[] {
  return uniqueTrimmed([...left, ...right]);
}

export function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
