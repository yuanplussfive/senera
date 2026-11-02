import { DefaultAgentTimeZone, formatAgentTimeMinute } from "../Time/AgentTime.js";

/** Adds the stable local-time marker used in model-facing memory projections. */
export function prefixAgentContinuityMemorySummary(
  summary: string,
  occurredAt: string,
  timeZone = DefaultAgentTimeZone,
): string {
  return `[${formatAgentTimeMinute(occurredAt, timeZone)}] ${summary}`;
}
