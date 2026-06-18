import type { ModelProviderListItem } from "../../api/eventTypes";
import type { ChatMessage, RunRecord } from "../../store/sessionStore";
import { formatModelProviderName } from "./modelProvider";

export function readAssistantDisplayName(
  message: Pick<ChatMessage, "metadata">,
  selectedModelProvider?: ModelProviderListItem,
): string {
  return formatModelProviderName(message.metadata?.run?.modelProvider ?? selectedModelProvider);
}

export function readAssistantDisplayContent(
  message: Pick<ChatMessage, "content" | "kind" | "requestId">,
  run?: Pick<RunRecord, "requestId" | "visibleText" | "displayText">,
): string {
  if (!run || message.requestId !== run.requestId) return message.content;
  if (!isDisplayDrivenAssistantKind(message.kind)) return message.content;
  if (!run.visibleText || run.visibleText !== message.content) return message.content;
  return run.displayText === run.visibleText ? message.content : run.displayText;
}

export function isTerminalAssistantMessageForRun(
  message: Pick<ChatMessage, "kind" | "requestId" | "role">,
  run?: Pick<RunRecord, "requestId">,
): boolean {
  return Boolean(
    run &&
    message.role === "assistant" &&
    message.requestId === run.requestId &&
    isDisplayDrivenAssistantKind(message.kind),
  );
}

export function readRunDisplayName(
  run: Pick<RunRecord, "modelProvider">,
  selectedModelProvider?: ModelProviderListItem,
): string {
  return formatModelProviderName(run.modelProvider ?? selectedModelProvider);
}

function isDisplayDrivenAssistantKind(kind: ChatMessage["kind"]): boolean {
  return kind === "FinalAnswer" || kind === "AskUser";
}
