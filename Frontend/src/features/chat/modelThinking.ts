import type { FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import type { ModelThinkingLevel } from "../../api/eventTypes";

/**
 * Pi's portable thinking vocabulary. These are protocol values, not provider
 * branches; provider-specific values belong in ThinkingLevelMap.
 */
export const ModelThinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ModelThinkingLevel[];

export const ModelThinkingLevelMessageKeys: Record<ModelThinkingLevel, FrontendMessageKey> = {
  off: "chat.thinking.off",
  minimal: "chat.thinking.minimal",
  low: "chat.thinking.low",
  medium: "chat.thinking.medium",
  high: "chat.thinking.high",
  xhigh: "chat.thinking.xhigh",
  max: "chat.thinking.max",
};
