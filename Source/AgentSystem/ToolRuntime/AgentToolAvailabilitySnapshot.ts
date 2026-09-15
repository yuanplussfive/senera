import type { AgentSessionMetadata } from "../ModelEndpoints/AgentModelMetadata.js";

export interface AgentToolAvailabilitySnapshot {
  runtimeFingerprint: string;
  loadedToolNames: string[];
  updatedAt: string;
}

export function resolveAgentToolAvailabilitySnapshot(
  metadata: AgentSessionMetadata | undefined,
  runtimeFingerprint: string | undefined,
): string[] | undefined {
  const snapshot = metadata?.toolAvailability;
  if (!snapshot || !runtimeFingerprint || snapshot.runtimeFingerprint !== runtimeFingerprint) {
    return undefined;
  }
  return [...snapshot.loadedToolNames];
}

export function withAgentToolAvailabilitySnapshot(
  metadata: AgentSessionMetadata | undefined,
  runtimeFingerprint: string,
  loadedToolNames: readonly string[],
): AgentSessionMetadata {
  return {
    ...metadata,
    toolAvailability: {
      runtimeFingerprint,
      loadedToolNames: [...new Set(loadedToolNames)],
      updatedAt: new Date().toISOString(),
    },
  };
}
