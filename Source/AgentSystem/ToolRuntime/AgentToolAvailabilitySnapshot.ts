import type { AgentSessionMetadata } from "../ModelEndpoints/AgentModelMetadata.js";

export interface AgentToolAvailabilitySnapshot {
  runtimeFingerprint: string;
  loadedToolNames: "all" | string[];
  updatedAt: string;
}

export function resolveAgentToolAvailabilitySnapshot(
  metadata: AgentSessionMetadata | undefined,
  runtimeFingerprint: string | undefined,
): "all" | string[] | undefined {
  const snapshot = metadata?.toolAvailability;
  if (!snapshot || !runtimeFingerprint || snapshot.runtimeFingerprint !== runtimeFingerprint) {
    return undefined;
  }
  return snapshot.loadedToolNames === "all" ? "all" : [...snapshot.loadedToolNames];
}

export function withAgentToolAvailabilitySnapshot(
  metadata: AgentSessionMetadata | undefined,
  runtimeFingerprint: string,
  loadedToolNames: "all" | readonly string[],
): AgentSessionMetadata {
  return {
    ...metadata,
    toolAvailability: {
      runtimeFingerprint,
      loadedToolNames: loadedToolNames === "all" ? "all" : [...new Set(loadedToolNames)],
      updatedAt: new Date().toISOString(),
    },
  };
}
