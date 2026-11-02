import type { McpInputStatus, McpInputValue, McpServerSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";

export type McpInputDraft = McpInputValue | "";

export interface McpSyncRequest {
  requestId: string;
  serverId: string;
  values: Record<string, McpInputValue>;
  deletes: readonly string[];
}

export function readMcpInputMutation(
  server: McpServerSettingsItem,
  drafts: Record<string, McpInputDraft>,
): { values?: Record<string, McpInputValue>; error?: string } {
  try {
    const values: Record<string, McpInputValue> = {};
    for (const input of server.inputs) {
      if (!(input.id in drafts)) continue;
      const draft = drafts[input.id];
      if (input.secret && draft === "") continue;
      const value = normalizeDraft(input, draft ?? "");
      if (input.required && isEmptyValue(value)) {
        throw new InputValidationError(frontendMessage("settings.mcp.inputValueRequired", { name: input.title }));
      }
      values[input.id] = value;
    }
    return { values: Object.keys(values).length > 0 ? values : undefined };
  } catch (error) {
    return {
      error:
        error instanceof InputValidationError
          ? error.message
          : frontendMessage("settings.mcp.inputValueInvalid", { name: server.id }),
    };
  }
}

export function readInputDisplayValue(
  input: McpInputStatus,
  draft: McpInputDraft | undefined,
  savedSecret: string | undefined,
): McpInputDraft {
  if (draft !== undefined) return draft;
  if (input.secret) {
    // Stored secrets are write-only; echo what the user saved during this
    // view, otherwise show nothing rather than a misleading default.
    return savedSecret ?? (input.configured ? "" : (input.defaultValue ?? ""));
  }
  return input.value ?? input.defaultValue ?? "";
}

export function applySavedSecrets(
  saved: Record<string, string>,
  request: McpSyncRequest,
  server: McpServerSettingsItem | undefined,
): Record<string, string> {
  const next = { ...saved };
  for (const inputId of request.deletes) delete next[inputId];
  for (const [inputId, value] of Object.entries(request.values)) {
    const input = server?.inputs.find((candidate) => candidate.id === inputId);
    if (input?.secret && typeof value === "string") next[inputId] = value;
  }
  return next;
}

export function reconcileMcpDrafts(
  drafts: Record<string, McpInputDraft>,
  request: McpSyncRequest,
  server: McpServerSettingsItem | undefined,
  outcome: "success" | "error",
): Record<string, McpInputDraft> {
  const next = { ...drafts };
  for (const [inputId, value] of Object.entries(request.values)) {
    if (outcome === "success") {
      if (inputId in next && sameDraft(next[inputId], value)) delete next[inputId];
      continue;
    }
    const input = server?.inputs.find((candidate) => candidate.id === inputId);
    if (input?.secret && !(inputId in next)) next[inputId] = value;
  }
  return next;
}

function normalizeDraft(input: McpInputStatus, draft: McpInputDraft): McpInputValue {
  if (input.multiple) {
    const values = Array.isArray(draft)
      ? draft
      : String(draft)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
    if (input.type === "number") {
      const numbers = values.map(Number);
      if (numbers.some((value) => !Number.isFinite(value))) throw new Error("Invalid number array.");
      return numbers;
    }
    if (input.type === "boolean") return values.map((value) => value === true || value === "true");
    return values.map(String);
  }
  if (input.type === "number") {
    if (draft === "") throw new Error("Number input is empty.");
    const value = Number(draft);
    if (!Number.isFinite(value)) throw new Error("Invalid number.");
    return value;
  }
  if (input.type === "boolean") return draft === true || draft === "true";
  return String(draft);
}

export function parseMultipleChoiceValues(type: McpInputStatus["type"], values: readonly string[]): McpInputValue {
  const parsed: unknown[] = values.map((entry) => JSON.parse(entry) as unknown);
  if (type === "number" && parsed.every((entry): entry is number => typeof entry === "number")) return parsed;
  if (type === "boolean" && parsed.every((entry): entry is boolean => typeof entry === "boolean")) return parsed;
  if (parsed.every((entry): entry is string => typeof entry === "string")) return parsed;
  throw new Error(`Invalid ${type} choice value.`);
}

function isEmptyValue(value: McpInputValue): boolean {
  return value === "" || (Array.isArray(value) && value.length === 0);
}

export function formatDraftValue(value: McpInputDraft): string | number {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "boolean" ? String(value) : value;
}

export function formatInputValue(value: McpInputValue): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

export function sameDraft(left: McpInputDraft, right: McpInputDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

class InputValidationError extends Error {}
