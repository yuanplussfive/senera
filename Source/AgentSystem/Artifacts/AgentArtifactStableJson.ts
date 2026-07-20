import crypto from "node:crypto";

export function stableArtifactHash(value: unknown): string {
  const hash = crypto.createHash("sha1");
  for (const chunk of stableArtifactJsonChunks(value)) hash.update(chunk);
  return hash.digest("hex");
}

export function stableArtifactStringify(value: unknown): string {
  return [...stableArtifactJsonChunks(value)].join("");
}

function* stableArtifactJsonChunks(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    yield "[";
    for (const [index, entry] of value.entries()) {
      if (index > 0) yield ",";
      yield* stableArtifactJsonChunks(entry);
    }
    yield "]";
    return;
  }

  if (value && typeof value === "object") {
    yield "{";
    const record = value as Record<string, unknown>;
    for (const [index, key] of Object.keys(record).sort().entries()) {
      if (index > 0) yield ",";
      yield JSON.stringify(key);
      yield ":";
      yield* stableArtifactJsonChunks(record[key]);
    }
    yield "}";
    return;
  }

  yield JSON.stringify(value) ?? String(value);
}
