import type { ConfigFailedData, ConfigMutationState } from "../api/eventTypes";

export const ConfigConflictErrorCode = "config_stale_write";

export function readConfigFailureCode(details: ConfigFailedData["details"]): string | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const code = (details as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

export function isConfigConflict(operation: ConfigMutationState | null | undefined): boolean {
  return operation?.errorCode === ConfigConflictErrorCode;
}
