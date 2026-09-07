export interface AgentChildRunWrapUpDetails {
  readonly reason?: "model_turn_budget" | "tool_call_budget" | "no_progress" | "deadline";
  readonly remainingTodo?: readonly {
    readonly id: string;
    readonly content: string;
    readonly status: string;
  }[];
}

export function renderAgentChildRunWrapUpInstruction(details: AgentChildRunWrapUpDetails = {}): string {
  const remaining = details.remainingTodo ?? [];
  return [
    "The child-run host has requested a bounded wrap-up.",
    "Stop investigating and do not start any new Tool calls or delegate more work.",
    "Wait only for Tool calls already in progress, then return the best concise final answer supported by the evidence collected so far.",
    "State material uncertainty or unfinished work explicitly instead of continuing the investigation.",
    ...(details.reason ? [`The host requested bounded wrap-up because: ${details.reason}.`] : []),
    ...(remaining.length > 0
      ? [`Remaining Todo items (report these with their current status): ${JSON.stringify(remaining)}.`]
      : ["There are no pending or in-progress Todo items to report separately."]),
  ].join(" ");
}
