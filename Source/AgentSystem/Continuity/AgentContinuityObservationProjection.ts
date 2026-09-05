import type { AgentMemorySourceKind } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentContinuityAuthority, AgentContinuityObservationKind } from "./AgentContinuityDomain.js";

export function agentContinuityObservationUri(anchorId: string): string {
  return `senera://continuity-observation/${encodeURIComponent(anchorId)}`;
}

export function agentContinuityObservationKind(sourceKind: AgentMemorySourceKind): AgentContinuityObservationKind {
  switch (sourceKind) {
    case "user_message":
      return "conversation.user_message";
    case "assistant_final":
      return "conversation.assistant_final";
    default:
      return "tool.result";
  }
}

export function agentContinuityObservationAuthority(sourceKind: AgentMemorySourceKind): AgentContinuityAuthority {
  switch (sourceKind) {
    case "user_message":
      return "user_explicit";
    case "assistant_final":
      return "system_observed";
    default:
      return "tool_verified";
  }
}

export function agentContinuityObservationConfidence(sourceKind: AgentMemorySourceKind): number {
  return sourceKind === "assistant_final" ? 0.9 : 1;
}
