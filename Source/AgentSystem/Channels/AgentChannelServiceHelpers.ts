import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import { resolveAgentChannelCommand } from "./AgentChannelCommandRegistry.js";
import type { AgentChannelAttachment, AgentChannelCommand } from "./AgentChannelTypes.js";
import type { AgentChildRunRecord } from "../Orchestration/AgentChildRunTypes.js";

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

export function renderInboundInput(text: string, attachments?: readonly AgentChannelAttachment[]): string {
  const media =
    attachments?.flatMap((attachment) => {
      const name = attachment.filename || attachment.contentType || "媒体附件";
      const target = attachment.url ? `：${attachment.url}` : "";
      const transcript = attachment.transcript?.trim();
      return [`[${name}${target}]`, ...(transcript ? [`[语音转写：${transcript}]`] : [])];
    }) ?? [];
  const parts = [text, ...media].filter((part) => part.length > 0);
  return parts.join("\n").trim();
}

export function isChannelTerminalEvent(event: AgentDomainEvent): boolean {
  return new Set(["run.completed", "run.failed", "run.cancelled"]).has(event.kind);
}

export function summarizeCompletion(record: AgentChildRunRecord): string {
  if (record.error) return `任务 ${record.task} 失败：${record.error}`;
  const answer = record.finalAnswer?.trim() || "（无最终回答）";
  return `任务：${record.task}\n${answer}`;
}

export function createShortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
