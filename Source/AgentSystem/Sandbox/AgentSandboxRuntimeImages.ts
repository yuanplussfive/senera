export function normalizeSandboxImages(configuredImages: readonly string[]): string[] {
  return [...new Set(configuredImages.map((image) => image.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}
