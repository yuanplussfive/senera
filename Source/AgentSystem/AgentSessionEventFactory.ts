import {
  AgentEventKinds,
  type AgentDomainEvent,
} from "./AgentEvent.js";
import { AgentConversationPolicy } from "./AgentConversationPolicy.js";
import type { AgentSession, AgentSessionSnapshot } from "./AgentSession.js";

export class AgentSessionEventFactory {
  constructor(
    private readonly conversationPolicy = new AgentConversationPolicy(),
  ) {}

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
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.SessionBusy,
      context: {
        sessionId: session.id,
        requestId: session.activeRequest?.requestId,
      },
      data: {
        sessionId: session.id,
        activeRequestId: session.activeRequest?.requestId ?? "",
        operation,
        message: "会话当前仍在处理中。",
      },
    };
  }

  notFound(
    sessionId: string,
    operation: "session.message" | "session.close" | "session.history",
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.SessionNotFound,
      context: {
        sessionId,
      },
      data: {
        sessionId,
        operation,
        message: "会话不存在。",
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
