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
  _run?: Pick<RunRecord, "requestId" | "visibleText" | "displayText">,
): string {
  return message.content;
}

export function readRunDisplayName(
  run: Pick<RunRecord, "modelProvider">,
  selectedModelProvider?: ModelProviderListItem,
): string {
  return formatModelProviderName(run.modelProvider ?? selectedModelProvider);
}
