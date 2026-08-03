import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

export function readConfiguredString(value: string | undefined, fallback: string): string {
  return value?.trim() ? value : fallback;
}

export function readOptionalConfiguredString(
  value: string | undefined,
  fallback: string | undefined,
): string | undefined {
  return value?.trim() ? value : fallback?.trim() ? fallback : undefined;
}

export function buildWebSocketUrl(server: Required<NonNullable<AgentSystemConfig["Server"]>>): string {
  return `ws://${server.Host}:${server.Port}`;
}
