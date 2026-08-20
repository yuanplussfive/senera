import { AgentConversationEntryKinds, type AgentConversationEntry } from "./AgentConversation.js";

export function authoritativeConversationSequence(
  entries: readonly AgentConversationEntry[],
): AgentConversationEntry[] {
  const users = new Map<string, Extract<AgentConversationEntry, { kind: "user.message" }>>();
  const assistants = new Map<string, Extract<AgentConversationEntry, { kind: "assistant.decision" }>>();

  for (const entry of entries) {
    if (entry.kind === AgentConversationEntryKinds.UserMessage) {
      users.set(entry.requestId, entry);
      continue;
    }
    const selected = assistants.get(entry.requestId);
    if (!selected || (!selected.metadata?.run && entry.metadata?.run)) {
      assistants.set(entry.requestId, entry);
    } else if (!selected.metadata?.run && !entry.metadata?.run) {
      assistants.set(entry.requestId, entry);
    }
  }

  return entries.filter((entry) =>
    entry.kind === AgentConversationEntryKinds.UserMessage
      ? users.get(entry.requestId) === entry
      : assistants.get(entry.requestId) === entry,
  );
}
