import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type {
  AgentLoopCommand,
  RunningAgentLoopMachineState,
} from "./AgentLoopStateTypes.js";

export function routeInteractionCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
  return {
    kind: "route_interaction",
    requestId: state.requestId,
    step: state.step,
    input: state.input,
    messages: state.messages,
    conversationEntries: state.conversationEntries,
    loadedToolNames: state.loadedToolNames,
    plannerLedger: state.plannerLedger,
    turnUnderstanding: state.turnUnderstanding,
  };
}

export function planActionCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
  return {
    kind: "plan_action",
    requestId: state.requestId,
    step: state.step,
    input: state.input,
    messages: state.messages,
    conversationEntries: state.conversationEntries,
    loadedToolNames: state.loadedToolNames,
    plannerLedger: state.plannerLedger,
    turnUnderstanding: state.turnUnderstanding,
  };
}

export function renderPromptCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
  return {
    kind: "render_prompt",
    requestId: state.requestId,
    step: state.step,
    input: state.input,
    loadedToolNames: state.loadedToolNames,
    rootCommand: state.rootCommand,
    systemPromptPreamble: state.systemPromptPreamble,
    activeSkills: state.activeSkills,
  };
}

export function nextDecisionCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
  return state.rootCommand?.outputMode === "tool_call_xml"
    ? collectToolCallPlanCommand(state)
    : renderPromptCommand(state);
}

export function collectToolCallPlanCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
  if (!state.rootCommand) {
    throw new Error("ToolCall Planner 需要 RootCommand。");
  }

  return {
    kind: "collect_tool_call_plan",
    requestId: state.requestId,
    step: state.step,
    input: state.input,
    messages: state.messages,
    conversationEntries: state.conversationEntries,
    rootCommand: state.rootCommand,
    loadedToolNames: state.loadedToolNames,
    plannerLedger: state.plannerLedger,
    activeSkills: state.activeSkills,
    toolPlanDiscoveryEscalated: state.toolPlanDiscoveryEscalated,
    turnUnderstanding: state.turnUnderstanding,
  };
}

export function stripRepairConversation(
  messages: AgentLanguageModelMessage[],
): AgentLanguageModelMessage[] {
  const last = messages.at(-1);
  const previous = messages.at(-2);
  return last?.role === "user" && previous?.role === "assistant"
    ? messages.slice(0, -2)
    : messages;
}

export function appendSystemPromptPreamble(
  current: string | undefined,
  addition: string | undefined,
): string | undefined {
  if (!current?.trim()) {
    return addition;
  }
  if (!addition?.trim()) {
    return current;
  }

  return `${current}\n\n${addition}`;
}
