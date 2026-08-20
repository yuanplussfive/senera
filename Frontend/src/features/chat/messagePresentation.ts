import type { ModelProviderListItem } from "../../api/eventTypes";
import type { ChatMessage, RunRecord } from "../../store/sessionStore";
import { formatModelProviderName, readModelProviderIcon } from "./modelProvider";

export function readAssistantDisplayName(
  message: Pick<ChatMessage, "metadata">,
  selectedModelProvider?: ModelProviderListItem,
): string {
  return formatModelProviderName(message.metadata?.run?.modelProvider ?? selectedModelProvider);
}

export function readAssistantDisplayContent(
  message: Pick<ChatMessage, "id" | "content" | "kind" | "requestId">,
  run?: Pick<RunRecord, "requestId" | "displayMessageId" | "displayText">,
): string {
  if (message.kind === "AssistantToolPreface" && run?.displayMessageId === message.id) {
    return run.displayText;
  }
  return message.content;
}

export function readAssistantDisplayIcon(
  message: Pick<ChatMessage, "metadata">,
  selectedModelProvider?: ModelProviderListItem,
): string | undefined {
  return readModelProviderIcon(message.metadata?.run?.modelProvider ?? selectedModelProvider);
}

export function readRunDisplayName(
  run: Pick<RunRecord, "modelProvider">,
  selectedModelProvider?: ModelProviderListItem,
): string {
  return formatModelProviderName(run.modelProvider ?? selectedModelProvider);
}

export function readRunDisplayIcon(
  run: Pick<RunRecord, "modelProvider">,
  selectedModelProvider?: ModelProviderListItem,
): string | undefined {
  return readModelProviderIcon(run.modelProvider ?? selectedModelProvider);
}
