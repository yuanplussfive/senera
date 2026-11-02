import { isAgentHumanUserMessage, type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentSession } from "./AgentSession.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentChannelKinds } from "../Channels/AgentChannelTypes.js";
import { formatAgentTimeMonthDayMinute } from "../Time/AgentTime.js";

const AgentSessionTitleMaxCharacters = 24;
const EmptySessionTitle = agentErrorMessage("session.defaultTitle");

export type AgentSessionListRecord = AgentSession & {
  entryCount: number;
  messageCount: number;
};

export class AgentSessionTitleProjector {
  constructor(private readonly loadFirstUserMessage: (sessionId: string) => AgentConversationEntry | undefined) {}

  project(session: AgentSessionListRecord): string {
    return deriveAgentSessionTitle(session, () =>
      session.messageCount > 0 ? this.loadFirstUserMessage(session.id) : undefined,
    );
  }
}

/** Shared by persistence, live snapshots and the session catalog. */
export function deriveAgentSessionTitle(
  session: AgentSession,
  loadFirstUserMessage?: () => AgentConversationEntry | undefined,
): string {
  const explicitTitle = session.metadata?.title?.trim();
  if (explicitTitle) return explicitTitle;
  const channel = session.metadata?.channel;
  if (channel?.platform === AgentChannelKinds.OneBot11 && channel.chatName?.trim()) {
    return `${compactTitle(channel.chatName)} · ${formatAgentTimeMonthDayMinute(session.createdAt)}`;
  }
  const entry = session.conversation.find(isAgentHumanUserMessage);
  const conversationTitle = entry ? compactTitle(entry.content) : undefined;
  if (conversationTitle) return conversationTitle;
  const persistedTitle = session.title?.trim();
  if (persistedTitle && persistedTitle !== EmptySessionTitle) return persistedTitle;
  const firstUser = loadFirstUserMessage?.();
  return (isAgentHumanUserMessage(firstUser) ? compactTitle(firstUser.content) : undefined) ?? EmptySessionTitle;
}

function compactTitle(content: string): string | undefined {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > AgentSessionTitleMaxCharacters ? `${text.slice(0, AgentSessionTitleMaxCharacters)}…` : text;
}
