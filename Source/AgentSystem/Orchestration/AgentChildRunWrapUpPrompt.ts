import { AgentPromptWireEncodings, renderAgentPromptWireBlocks } from "../Prompt/AgentPromptContextWireRenderer.js";

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
  const instruction = [
    "The child-run host has requested a bounded wrap-up.",
    "Stop investigating and do not start any new Tool calls or delegate more work.",
    "Wait only for Tool calls already in progress, then return the best concise final answer supported by the evidence collected so far.",
    "State material uncertainty or unfinished work explicitly instead of continuing the investigation.",
    ...(details.reason ? [`The host requested bounded wrap-up because: ${details.reason}.`] : []),
  ].join(" ");
  if (remaining.length === 0) {
    return `${instruction} There are no pending or in-progress Todo items to report separately.`;
  }
  const todoWire = renderAgentPromptWireBlocks(
    {
      preamble: [
        "senera.child_run_wrap_up=v1",
        "provenance=host;not-user-input",
        "rule=report-current-status-only;do-not-start-new-work",
      ],
      blocks: [
        {
          id: "remaining_todos",
          value: { items: remaining },
          allowedEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
        },
      ],
    },
    { estimateTokens: (text) => text.length },
  ).text;
  return `${instruction} Report the remaining Todo items and their current status from this host-owned wire:\n\n${todoWire}`;
}
