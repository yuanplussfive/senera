import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import type { AgentSession, AgentSessionSnapshot } from "./AgentSession.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export class AgentSessionEventFactory {
  constructor(private readonly conversationPolicy = new AgentConversationPolicy()) {}

  created(session: AgentSession): AgentDomainEvent {
    return {
      kind: AgentEventKinds.SessionCreated,
      context: {
        sessionId: session.id,
      },
      data: this.snapshotData(session),
    };
  }

  snapshot(session: AgentSession): AgentDomainEvent {
    return {
      kind: AgentEventKinds.SessionSnapshot,
      context: {
        sessionId: session.id,
        requestId: session.activeRequest?.requestId,
      },
      data: this.snapshotData(session),
    };
  }

  closed(session: AgentSession): AgentDomainEvent {
    return {
      kind: AgentEventKinds.SessionClosed,
      context: {
        sessionId: session.id,
      },
      data: this.snapshotData(session),
    };
  }

  busy(
    session: AgentSession,
    operation: "session.message" | "session.close",
    rejectedRequestId?: string,
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.SessionBusy,
      context: {
        sessionId: session.id,
        requestId: rejectedRequestId ?? session.activeRequest?.requestId,
      },
      data: {
        sessionId: session.id,
        activeRequestId: session.activeRequest?.requestId ?? "",
        rejectedRequestId,
        operation,
        message: agentErrorMessage("session.stillBusy"),
      },
    };
  }

  notFound(
    sessionId: string,
    operation: "session.message" | "session.close" | "session.history" | "session.fork",
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.SessionNotFound,
      context: {
        sessionId,
      },
      data: {
        sessionId,
        operation,
        message: agentErrorMessage("session.notFound"),
      },
    };
  }

  private snapshotData(session: AgentSession): AgentSessionSnapshot {
    return {
      sessionId: session.id,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      entryCount: session.conversation.length,
      messageCount: this.conversationPolicy.materialize(session.conversation).length,
      turnCount: session.conversation.filter((entry) => entry.kind === "user.message").length,
      activeRequestId: session.activeRequest?.requestId,
    };
  }
}
