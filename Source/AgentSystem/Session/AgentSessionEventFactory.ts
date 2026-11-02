import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentSession } from "./AgentSession.js";
import { projectAgentMessage } from "../I18n/AgentMessageProjection.js";
import type { AgentSessionOperation } from "./AgentSessionOperation.js";
import { projectAgentSessionSnapshot } from "./AgentSessionSnapshotProjection.js";

export class AgentSessionEventFactory {
  created(session: AgentSession): AgentDomainEvent {
    return {
      kind: AgentEventKinds.SessionCreated,
      context: {
        sessionId: session.id,
      },
      data: projectAgentSessionSnapshot(session),
    };
  }

  snapshot(session: AgentSession): AgentDomainEvent {
    return {
      kind: AgentEventKinds.SessionSnapshot,
      context: {
        sessionId: session.id,
        requestId: session.activeRequest?.requestId,
      },
      data: projectAgentSessionSnapshot(session),
    };
  }

  closed(session: AgentSession): AgentDomainEvent {
    return {
      kind: AgentEventKinds.SessionClosed,
      context: {
        sessionId: session.id,
      },
      data: projectAgentSessionSnapshot(session),
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
        ...projectAgentMessage("session.stillBusy"),
      },
    };
  }

  notFound(sessionId: string, operation: AgentSessionOperation, requestId?: string): AgentDomainEvent {
    return {
      kind: AgentEventKinds.SessionNotFound,
      context: {
        sessionId,
        ...(requestId ? { requestId } : {}),
      },
      data: {
        sessionId,
        operation,
        ...projectAgentMessage("session.notFound"),
      },
    };
  }
}
