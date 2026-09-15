import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

const RunEventTypes = new Set<AgentPiRunEvent["type"]>([
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

export type AgentPiRunEvent = Extract<
  AgentSessionEvent,
  {
    type:
      | "message_start"
      | "message_update"
      | "message_end"
      | "tool_execution_start"
      | "tool_execution_update"
      | "tool_execution_end";
  }
>;

export type AgentPiCompactionLifecycleEvent = Extract<
  AgentSessionEvent,
  { type: "compaction_start" | "compaction_end" }
>;

export function isAgentPiRunEvent(event: AgentSessionEvent): event is AgentPiRunEvent {
  return RunEventTypes.has(event.type as AgentPiRunEvent["type"]);
}

export function isAgentPiCompactionLifecycleEvent(event: AgentSessionEvent): event is AgentPiCompactionLifecycleEvent {
  return event.type === "compaction_start" || event.type === "compaction_end";
}
