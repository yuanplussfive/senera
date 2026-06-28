import { WebSocket } from "ws";
import {
  AgentEventSequencer,
  type AgentDomainEvent,
  type AgentEventEnvelope,
  toEventEnvelope,
} from "../Events/AgentEvent.js";
import { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { projectAgentRunEventForHistory } from "../Events/AgentRunEventHistoryPolicy.js";
import type { AgentSessionManager } from "../Session/AgentSessionManager.js";

export class AgentWebSocketEventEnvelopeSender {
  private readonly sequencer = new AgentEventSequencer();

  constructor(
    private readonly options: {
      logger: AgentLogger;
      sessionManager: AgentSessionManager;
    },
  ) {}

  broadcast(clients: Iterable<WebSocket>, event: AgentDomainEvent): void {
    const payload = this.serialize(toEventEnvelope(event, this.sequencer.next()));
    for (const client of clients) {
      this.send(client, payload);
    }
  }

  sendEnvelope(socket: WebSocket, event: AgentDomainEvent): void {
    const envelope = toEventEnvelope(event, this.sequencer.next());
    this.persistRunEvent(envelope);
    this.send(socket, this.serialize(envelope));
  }

  private send(socket: WebSocket, payload: string): void {
    if (socket.readyState !== socket.OPEN) {
      return;
    }

    socket.send(payload);
  }

  private serialize(payload: unknown): string {
    return JSON.stringify(payload);
  }

  private persistRunEvent(envelope: AgentEventEnvelope): void {
    const projected = projectAgentRunEventForHistory(envelope);
    if (!projected) {
      return;
    }

    try {
      this.options.sessionManager.recordRunEvent(projected);
    } catch (error) {
      this.options.logger.warn("执行事件持久化失败", {
        kind: projected.kind,
        requestId: projected.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
