export function normalizeSandboxImages(
  configuredImages: readonly string[],
  extraImages: readonly string[] = [],
): string[] {
  return [...new Set([...configuredImages, ...extraImages].map((image) => image.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}
