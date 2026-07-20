import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import {
  AgentEventPersistenceStates,
  type AgentRunEventWriter,
  type AgentRunEventWriterHealth,
} from "./AgentRunEventWriter.js";

export class AgentCallbackRunEventWriter implements AgentRunEventWriter {
  private committedBatches = 0;
  private failedBatches = 0;
  private lastError?: string;
  private readonly committedEventWatermarks: Record<string, number> = {};

  constructor(private readonly persist: (events: readonly AgentEventEnvelope[]) => void) {}

  async append(events: readonly AgentEventEnvelope[]): Promise<void> {
    try {
      this.persist(events);
      this.committedBatches += 1;
      for (const event of events) {
        if (!event.sessionId) continue;
        this.committedEventWatermarks[event.sessionId] = Math.max(
          this.committedEventWatermarks[event.sessionId] ?? 0,
          event.sequence,
        );
      }
      this.lastError = undefined;
    } catch (error) {
      this.failedBatches += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}

  health(): AgentRunEventWriterHealth {
    return {
      state: this.lastError ? AgentEventPersistenceStates.Degraded : AgentEventPersistenceStates.Healthy,
      pendingBatches: 0,
      committedBatches: this.committedBatches,
      committedEventWatermarks: { ...this.committedEventWatermarks },
      failedBatches: this.failedBatches,
      restartCount: 0,
      lastError: this.lastError,
    };
  }
}
