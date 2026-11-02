import type { AgentChannelAdapterRegistry } from "./AgentChannelAdapterRegistry.js";
import { resolveAgentChannelSessionId, serializeAgentChannelLane } from "./AgentChannelSessionIdentity.js";
import type { AgentChannelSessionMappingStore } from "./AgentChannelSessionMappingStore.js";
import type { AgentChannelSource } from "./AgentChannelTypes.js";
import type { AgentChannelParticipationStore } from "./AgentChannelParticipationStore.js";

/** Keeps protocol history and session epochs in the same recoverable close lifecycle. */
export class AgentChannelSessionLifecycle {
  private readonly transitions = new Map<string, Promise<void>>();
  constructor(
    private readonly mappings: AgentChannelSessionMappingStore,
    private readonly registry: AgentChannelAdapterRegistry,
    private readonly participation?: AgentChannelParticipationStore,
  ) {}

  async release(sessionId: string): Promise<void> {
    const lane = this.mappings.getBySession(sessionId);
    if (!lane) return;
    const key = serializeAgentChannelLane(lane);
    const existing = this.transitions.get(key);
    if (existing) return existing;
    const transition = Promise.resolve().then(async () => {
      this.participation?.cancel(sessionId);
      if (!lane.agentId || lane.chatType !== "group") await this.registry.clearHistory(lane);
      if (!lane.agentId || lane.chatType !== "group") this.participation?.clear(lane);
      const epoch = lane.epoch + 1;
      this.mappings.resetEpoch(lane, resolveAgentChannelSessionId(lane, epoch), epoch, new Date().toISOString());
    });
    this.transitions.set(key, transition);
    try {
      await transition;
    } finally {
      if (this.transitions.get(key) === transition) this.transitions.delete(key);
    }
  }

  async waitFor(source: AgentChannelSource): Promise<void> {
    await this.transitions.get(serializeAgentChannelLane(source));
  }
}
