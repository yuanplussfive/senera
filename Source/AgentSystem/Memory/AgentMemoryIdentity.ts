import crypto from "node:crypto";

const MemoryUriAuthorities = {
  episode: "memory-episode",
  source: "memory-source",
} as const;

export function stableMemoryId(prefix: string, parts: readonly string[]): string {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return `${prefix}_${hash.digest("hex").slice(0, 24)}`;
}

export function memoryEpisodeUri(id: string): string {
  return memoryUri(MemoryUriAuthorities.episode, id);
}

export function memorySourceUri(id: string): string {
  return memoryUri(MemoryUriAuthorities.source, id);
}

function memoryUri(authority: string, id: string): string {
  return `senera://${authority}/${id}`;
}
