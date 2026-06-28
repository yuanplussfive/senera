import crypto from "node:crypto";

export function stableArtifactHash(value: unknown): string {
  return crypto.createHash("sha1").update(stableArtifactStringify(value)).digest("hex");
}

export function stableArtifactStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableArtifactStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableArtifactStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? String(value);
}
