export function limitText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

export function toJsonObject(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

export function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }

  let count = 1;
  for (const char of value) {
    if (char === "\n") {
      count += 1;
    }
  }
  return count;
}
