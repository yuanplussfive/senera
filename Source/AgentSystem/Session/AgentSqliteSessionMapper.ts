import {
  AgentConversationEntryKinds,
} from "../Conversation/AgentConversation.js";
import { parseJsonObject } from "../SessionPersistence/AgentSessionCodec.js";
import type { SessionRow } from "../SessionPersistence/AgentSessionSqlRows.js";
import {
  AgentSessionStatuses,
  type AgentSession,
  type AgentSessionStatus,
} from "./AgentSession.js";

export function deriveAgentSessionTitle(session: AgentSession): string {
  const firstUser = session.conversation.find(
    (entry) => entry.kind === AgentConversationEntryKinds.UserMessage,
  );
  if (firstUser?.kind === AgentConversationEntryKinds.UserMessage) {
    const text = firstUser.content.replace(/\s+/g, " ").trim();
    if (text) return text.length > 24 ? `${text.slice(0, 24)}…` : text;
  }
  return "新对话";
}

export function rowToAgentSession(row: SessionRow): AgentSession {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: parseStoredAgentSessionStatus(row.status),
    conversation: [],
    metadata: parseJsonObject(row.metadata),
  };
}

function parseStoredAgentSessionStatus(raw: string): AgentSessionStatus {
  if (raw === AgentSessionStatuses.Running) return AgentSessionStatuses.Idle;
  if (raw === AgentSessionStatuses.Idle) return AgentSessionStatuses.Idle;
  return AgentSessionStatuses.Idle;
}
