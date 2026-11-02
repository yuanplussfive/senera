import { resolveAgentSessionModelProviderId } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentSession, AgentSessionSnapshot } from "./AgentSession.js";
import { deriveAgentSessionTitle } from "./AgentSessionTitleProjector.js";

/**
 * The sole projection from durable session state to the public session
 * snapshot. Event publication and self-service must expose the same fields.
 */
export function projectAgentSessionSnapshot(session: AgentSession): AgentSessionSnapshot {
  const modelProviderId = resolveAgentSessionModelProviderId(session.metadata);
  const effectiveModel =
    session.metadata?.activeRun?.receipt ?? session.activeRequest?.effectiveModel ?? session.metadata?.lastRun?.receipt;
  return {
    sessionId: session.id,
    status: session.status,
    title: deriveAgentSessionTitle(session),
    ...(session.metadata?.agentId ? { agentId: session.metadata.agentId } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    entryCount: session.conversation.length,
    messageCount: session.conversation.length,
    turnCount: session.conversation.filter((entry) => entry.kind === "user.message").length,
    activeRequestId: session.activeRequest?.requestId,
    ...(session.metadata?.channel ? { channel: session.metadata.channel } : {}),
    ...(modelProviderId ? { modelProviderId } : {}),
    ...(effectiveModel ? { effectiveModel: structuredClone(effectiveModel) } : {}),
    ...(session.metadata?.sessionModel ? { modelPreference: structuredClone(session.metadata.sessionModel) } : {}),
  };
}
