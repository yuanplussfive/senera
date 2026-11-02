import type { ModelThinkingLevel } from "../../api/eventTypes";

/**
 * Pi's portable reasoning vocabulary. These are protocol values shared by the
 * model catalog and the chat selector; user-facing profiles only rename them.
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
