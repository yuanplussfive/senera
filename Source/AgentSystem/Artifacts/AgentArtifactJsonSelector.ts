export function selectJsonValues(root: unknown, selector: string): unknown[] {
  const trimmed = selector.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed === "$") {
    return [root];
  }
  if (!trimmed.startsWith("$.")) {
    return [];
  }

  return selectPath(root, parseSelector(trimmed.slice(2)));
}

function selectPath(values: unknown, segments: readonly string[]): unknown[] {
  if (segments.length === 0) {
    return [values];
  }

  const [head, ...tail] = segments;
  if (head === "*") {
    return Array.isArray(values)
      ? values.flatMap((entry) => selectPath(entry, tail))
      : [];
  }

  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return [];
  }

  return selectPath((values as Record<string, unknown>)[head], tail);
}

function parseSelector(selector: string): string[] {
  const segments: string[] = [];
  let current = "";

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];

    if (char === ".") {
      pushSegment(segments, current);
      current = "";
      continue;
    }

    if (char === "[" && selector[index + 1] === "*" && selector[index + 2] === "]") {
      pushSegment(segments, current);
      current = "";
      segments.push("*");
      index += 2;
      continue;
    }

    current += char;
  }

  pushSegment(segments, current);
  return segments;
}

function pushSegment(segments: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed) {
    segments.push(trimmed);
  }
}
