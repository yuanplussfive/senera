import crypto from "node:crypto";

const MemoryUriAuthorities = {
  candidate: "memory-candidate",
  episode: "memory-episode",
  item: "memory-item",
  observation: "memory-observation",
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

export function randomMemoryId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function memoryCandidateUri(id: string): string {
  return memoryUri(MemoryUriAuthorities.candidate, id);
}

export function memoryEpisodeUri(id: string): string {
  return memoryUri(MemoryUriAuthorities.episode, id);
}

export function memoryItemUri(id: string): string {
  return memoryUri(MemoryUriAuthorities.item, id);
}

export function memoryObservationUri(id: string): string {
  return memoryUri(MemoryUriAuthorities.observation, id);
}

export function memorySourceUri(id: string): string {
  return memoryUri(MemoryUriAuthorities.source, id);
}

function memoryUri(authority: string, id: string): string {
  return `senera://${authority}/${id}`;
}
