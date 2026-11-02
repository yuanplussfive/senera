import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { resolveAgentChannelCommand } from "./AgentChannelCommandRegistry.js";
import type {
  AgentChannelAttachment,
  AgentChannelCommand,
  AgentChannelConfig,
  AgentChannelInboundMessage,
  AgentChannelSource,
} from "./AgentChannelTypes.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentChildRunRecord } from "../Orchestration/AgentChildRunTypes.js";

/** Preserve protocol parts while linking their media to the ordinary upload store. */
export function projectChannelMessageSegments(
  message: AgentChannelInboundMessage,
  attachments: readonly AgentUploadAttachment[] | undefined,
) {
  const uploadedById = new Map<string, AgentUploadAttachment | undefined>();
  for (const [index, attachment] of message.attachments?.entries() ?? []) {
    if (attachment.id !== undefined && !uploadedById.has(attachment.id)) {
      uploadedById.set(attachment.id, attachments?.[index]);
    }
  }
  return message.segments?.map((segment) => {
    const attachmentId = segment.data.attachmentId;
    const attachment = typeof attachmentId === "string" ? uploadedById.get(attachmentId) : undefined;
    return attachment
      ? { type: segment.type, data: { ...segment.data, resourceUri: attachment.resourceUri } }
      : segment;
  });
}

export function authorizeChannelSource(
  config: Pick<AgentChannelConfig, "allowAllUsers" | "dmPolicy" | "groupPolicy" | "allowedUsers" | "groupAllowedUsers">,
  source: AgentChannelSource,
): boolean {
  if (config.allowAllUsers === true) return true;
  const isDirect = source.chatType === "direct";
  const policy = isDirect ? config.dmPolicy : config.groupPolicy;
  if (policy === "open") return true;
  if (policy === "disabled" || policy === "pairing") return false;
  const matches = (allowed: readonly string[] | undefined): boolean =>
    allowed?.some((candidate) => candidate === source.chatId || candidate === source.userId) === true;
  return matches(config.allowedUsers) || (!isDirect && matches(config.groupAllowedUsers));
}

export function parseChannelCommand(text: string, prefix: string): AgentChannelCommand | undefined {
  if (!prefix || !text.startsWith(prefix)) return undefined;
  const body = text.slice(prefix.length).split(/\s+/)[0] ?? "";
  const command = body.split("@")[0]?.toLowerCase();
  if (!command || command.length === 0) return undefined;
  return resolveAgentChannelCommand(command);
}

export function commandArguments(text: string, prefix: string): string {
  const body = prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
  return body.replace(/^\S+\s*/, "").trim();
}

/**
 * Preserve the sender's text. Files use the ordinary session attachment
 * boundary; only an existing voice transcript contributes additional text.
 */
export function renderInboundInput(text: string, attachments?: readonly AgentChannelAttachment[]): string {
  const transcripts =
    attachments?.flatMap((attachment) => (attachment.transcript ? [attachment.transcript] : [])) ?? [];
  return [text, ...transcripts].filter((part) => part.length > 0).join("\n");
}

const channelTerminalEvents: ReadonlySet<string> = new Set([
  AgentEventKinds.RunCompleted,
  AgentEventKinds.RunFailed,
  AgentEventKinds.RunCancelled,
]);

export function isChannelTerminalEvent(event: AgentDomainEvent): boolean {
  return channelTerminalEvents.has(event.kind);
}

export function summarizeCompletion(record: AgentChildRunRecord): string {
  if (record.error) return `任务 ${record.task} 失败：${record.error}`;
  const answer = record.finalAnswer?.trim() || "（无最终回答）";
  return `任务：${record.task}\n${answer}`;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
