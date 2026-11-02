import { createHash } from "node:crypto";
import type { AgentChannelSource } from "./AgentChannelTypes.js";

const SessionIdPrefix = "senera_channel_";
const SessionIdLength = 40;

/**
 * Deterministic senera session identity for one conversation lane. The same
 * lane always resolves to the same session unless the epoch is bumped by a
 * `/new` command. No registration table and no custom state is required to
 * resume a conversation after a restart.
 */
export function resolveAgentChannelSessionId(source: AgentChannelSource, epoch: number): string {
  const lane = serializeAgentChannelLane(source);
  const digest = createHash("sha256").update(`${lane}\nepoch:${epoch}`).digest("hex");
  return `${SessionIdPrefix}${digest.slice(0, SessionIdLength)}`;
}

/**
 * Canonical lane serialization. Discord threads and Telegram group topics get
 * their own lanes; reordering or renaming these parts would silently detach
 * conversations, so the format is treated as a stable contract.
 */
export function serializeAgentChannelLane(source: AgentChannelSource): string {
  const thread = source.threadId ? `:${source.threadId}` : "";
  const agent = source.chatType === "group" && source.agentId ? `:agent:${source.agentId}` : "";
  const lane = `${source.platform}:${source.chatType}:${source.chatId}:${source.userId}${thread}${agent}`;
  return source.authority ? JSON.stringify([source.authority, lane]) : lane;
}

/** Public conversation history is shared by every recipient Agent. */
export function serializeAgentChannelConversation(source: AgentChannelSource): string {
  return serializeAgentChannelLane({ ...source, agentId: undefined });
}

export function isSameAgentChannelConversation(left: AgentChannelSource, right: AgentChannelSource): boolean {
  return serializeAgentChannelConversation(left) === serializeAgentChannelConversation(right);
}

/**
 * Compares conversation lanes through the same stable identity used to derive
 * their session IDs. Callers must not independently recreate this equality
 * rule: adding a routing field then changes every channel boundary together.
 */
export function isSameAgentChannelLane(left: AgentChannelSource, right: AgentChannelSource): boolean {
  return serializeAgentChannelLane(left) === serializeAgentChannelLane(right);
}

export function isAgentChannelSessionId(sessionId: string): boolean {
  return sessionId.startsWith(SessionIdPrefix);
}

export function agentChannelSessionPrefix(): string {
  return SessionIdPrefix;
}
