import type { AgentSessionMetadata } from "../ModelEndpoints/AgentModelMetadata.js";

export const AgentPiSessionLifecycleStates = {
  Absent: "absent",
  Initialized: "initialized",
} as const;

export type AgentPiSessionLifecycleState =
  (typeof AgentPiSessionLifecycleStates)[keyof typeof AgentPiSessionLifecycleStates];

export interface AgentPiSessionLifecycleMetadata {
  state: AgentPiSessionLifecycleState;
  updatedAt: string;
  modelProviderId?: string;
}

export interface AgentPiSessionLifecycleResolution {
  initialized: boolean;
  modelProviderId?: string;
}

export function resolveAgentPiSessionLifecycle(
  metadata: AgentSessionMetadata | undefined,
): AgentPiSessionLifecycleResolution {
  const lifecycle = metadata?.piSession;
  if (lifecycle) {
    return {
      initialized: lifecycle.state === AgentPiSessionLifecycleStates.Initialized,
      modelProviderId: lifecycle.modelProviderId,
    };
  }

  return {
    initialized: Boolean(metadata?.lastRun),
    modelProviderId: metadata?.lastRun?.modelProvider.id,
  };
}

export function withAgentPiSessionLifecycle(
  metadata: AgentSessionMetadata | undefined,
  state: AgentPiSessionLifecycleState,
  modelProviderId?: string,
): AgentSessionMetadata {
  return {
    ...metadata,
    piSession: {
      state,
      updatedAt: new Date().toISOString(),
      modelProviderId: modelProviderId?.trim() || metadata?.piSession?.modelProviderId,
    },
  };
}
