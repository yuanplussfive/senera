import { randomUUID } from "node:crypto";

const AgentProductName = "senera";
const ShortOpaqueIdLength = 8;
const ToolCallPrefix = "call";

export function createOpaqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function createRequestId(): string {
  return createOpaqueId("run");
}

export function createSessionId(): string {
  return createOpaqueId(`${AgentProductName}_session`);
}

export function createToolCallId(): string {
  return `${ToolCallPrefix}_${randomUUID().replace(/-/g, "").slice(0, ShortOpaqueIdLength)}`;
}

export function describeSessionHandle(sessionId: string): string {
  const tail = sessionId.split("_").at(-1) ?? sessionId;
  return `${AgentProductName}:${tail.slice(0, ShortOpaqueIdLength)}`;
}
