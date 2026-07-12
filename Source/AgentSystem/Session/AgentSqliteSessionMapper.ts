import { AgentConversationEntryKinds } from "../Conversation/AgentConversation.js";
import { parseJsonObject } from "../SessionPersistence/AgentSessionCodec.js";
import type { SessionRow } from "../SessionPersistence/AgentSessionSqlRows.js";
import { AgentSessionStatuses, type AgentSession, type AgentSessionStatus } from "./AgentSession.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export function deriveAgentSessionTitle(session: AgentSession): string {
  const firstUser = session.conversation.find((entry) => entry.kind === AgentConversationEntryKinds.UserMessage);
  if (firstUser?.kind === AgentConversationEntryKinds.UserMessage) {
    const text = firstUser.content.replace(/\s+/g, " ").trim();
    if (text) return text.length > 24 ? `${text.slice(0, 24)}…` : text;
  }
  return agentErrorMessage("session.defaultTitle");
}

export function rowToAgentSession(row: SessionRow): AgentSession {
  const metadata = parseJsonObject(row.metadata);
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: parseStoredAgentSessionStatus(row.status),
    conversation: [],
    metadata: {
      ...metadata,
      title: readStoredTitle(row.title) ?? readStoredTitle(metadata.title),
    },
  };
}

function readStoredTitle(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseStoredAgentSessionStatus(raw: string): AgentSessionStatus {
  if (raw === AgentSessionStatuses.Running) return AgentSessionStatuses.Idle;
  if (raw === AgentSessionStatuses.Idle) return AgentSessionStatuses.Idle;
  return AgentSessionStatuses.Idle;
}
