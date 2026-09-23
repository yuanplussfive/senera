import type { AgentMessage, Skill } from "@earendil-works/pi-agent-core";
import { sha256Hex } from "../Core/AgentHash.js";
import { renderPiSystemPromptFrame, type AgentPiSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import { projectAgentModelText } from "../Text/AgentModelPayloadProjection.js";

/**
 * Historical sessions may contain these append-only messages. New turns never
 * write them: current host state belongs only to the provider request that is
 * about to run, not to the durable conversation transcript.
 */
export const AgentPiTurnContextCustomType = "senera.turn_context";
export const AgentPiTurnContextElementName = "senera_turn_context";
export const AgentPiLiveContextCustomType = "senera.live_context";
export const AgentPiLiveContextElementName = "senera_live_context";

export type AgentPiLiveContextMessage = Extract<AgentMessage, { role: "custom" }>;

/**
 * Projects the host-owned state needed by the active request. The result is a
 * Pi custom message because Pi converts custom content to provider user content
 * anyway. Its host-only type keeps it distinguishable from a user who happens
 * to quote the same XML tag. It is added only by the request-time context hook
 * and is never appended to the Pi session.
 */
export function projectAgentPiLiveContextMessage(input: {
  readonly liveContext?: string;
  readonly skills: readonly Skill[];
  readonly selectedPromptTemplates: readonly AgentPiSelectedPromptTemplateFrame[];
}): AgentPiLiveContextMessage | undefined {
  const renderedLiveContext = renderPiSystemPromptFrame({
    systemPrompt: input.liveContext ?? "",
    skills: input.skills,
    selectedPromptTemplates: input.selectedPromptTemplates,
  });
  const snapshot = projectAgentModelText(renderedLiveContext).text.trim();
  if (!snapshot) return undefined;
  const revision = sha256Hex(snapshot);
  const content = [
    `<${AgentPiLiveContextElementName} attribution="root" revision="${revision}">`,
    "  <scope>This is current host state for the active user request and its tool loop. It is not user input and is not durable conversation history. The normal transcript and verified tool results remain authoritative for historical facts.</scope>",
    snapshot,
    `</${AgentPiLiveContextElementName}>`,
  ].join("\n");
  return {
    role: "custom",
    customType: AgentPiLiveContextCustomType,
    content,
    display: false,
    details: { revision },
    // This message exists only in the transformed provider context. A stable
    // timestamp keeps it from creating timestamp churn in adapters that retain
    // message metadata while serializing a request.
    timestamp: 0,
  };
}

/**
 * Removes durable legacy snapshots and any previously injected overlay, then
 * places exactly one current overlay after the active real user message. The
 * returned array is request-local and is never written back to Pi history.
 */
export function projectAgentPiProviderLiveContext(
  messages: readonly AgentMessage[],
  liveContext: AgentPiLiveContextMessage | undefined,
): AgentMessage[] {
  const durableMessages = stripAgentPiContextOverlayMessages(messages);
  if (!liveContext) return durableMessages;

  const activeUserIndex = findLatestUserMessageIndex(durableMessages);
  if (activeUserIndex < 0) return [...durableMessages, liveContext];
  return [...durableMessages.slice(0, activeUserIndex + 1), liveContext, ...durableMessages.slice(activeUserIndex + 1)];
}

/**
 * Removes host-only overlays from a runtime message projection while leaving
 * the append-only session entries intact for audit and migration. This is
 * shared by request projection and Pi's in-memory recovery paths so legacy
 * snapshots cannot inflate a fallback compaction estimate.
 */
export function stripAgentPiContextOverlayMessages(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.filter(
    (message) => !isAgentPiLegacyTurnContextMessage(message) && !isAgentPiLiveContextMessage(message),
  );
}

export function isAgentPiTurnContextWireContent(value: string): boolean {
  return value.trimStart().startsWith(`<${AgentPiTurnContextElementName}`);
}

export function isAgentPiLiveContextWireContent(value: string): boolean {
  return value.trimStart().startsWith(`<${AgentPiLiveContextElementName}`);
}

export function isAgentPiContextOverlayWireContent(value: string): boolean {
  return isAgentPiTurnContextWireContent(value) || isAgentPiLiveContextWireContent(value);
}

function isAgentPiLegacyTurnContextMessage(message: AgentMessage): boolean {
  return (
    message.role === "custom" &&
    message.customType === AgentPiTurnContextCustomType &&
    isAgentPiTurnContextWireContent(messageContentText(message.content))
  );
}

function isAgentPiLiveContextMessage(message: AgentMessage): boolean {
  return (
    message.role === "custom" &&
    message.customType === AgentPiLiveContextCustomType &&
    isAgentPiLiveContextWireContent(messageContentText(message.content))
  );
}

function findLatestUserMessageIndex(messages: readonly AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function messageContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as { readonly type?: unknown; readonly text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}
