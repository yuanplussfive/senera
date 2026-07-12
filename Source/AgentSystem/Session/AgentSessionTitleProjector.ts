import { AgentConversationEntryKinds, type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentSession } from "./AgentSession.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

const AgentSessionTitleMaxCharacters = 24;
const EmptySessionTitle = agentErrorMessage("session.defaultTitle");

export type AgentSessionListRecord = AgentSession & {
  entryCount: number;
  messageCount: number;
};

export class AgentSessionTitleProjector {
  constructor(private readonly loadConversation: (sessionId: string) => AgentConversationEntry[]) {}

  project(session: AgentSessionListRecord): string {
    return this.readTitleFromEntries(session.conversation) ?? this.readPersistedTitle(session) ?? EmptySessionTitle;
  }

  private readPersistedTitle(session: AgentSessionListRecord): string | undefined {
    const metadataTitle = this.compactTitle(session.metadata?.title ?? "");
    if (metadataTitle) {
      return metadataTitle;
    }

    if (session.messageCount === 0) {
      return undefined;
    }

    return this.readTitleFromEntries(this.loadConversation(session.id));
  }

  private readTitleFromEntries(entries: readonly AgentConversationEntry[]): string | undefined {
    const firstUserMessage = entries.find((entry) => entry.kind === AgentConversationEntryKinds.UserMessage);
    if (!firstUserMessage || firstUserMessage.kind !== AgentConversationEntryKinds.UserMessage) {
      return undefined;
    }

    return this.compactTitle(firstUserMessage.content);
  }

  private compactTitle(content: string): string | undefined {
    const text = content.replace(/\s+/g, " ").trim();
    if (!text) {
      return undefined;
    }

    return text.length > AgentSessionTitleMaxCharacters ? `${text.slice(0, AgentSessionTitleMaxCharacters)}…` : text;
  }
}
