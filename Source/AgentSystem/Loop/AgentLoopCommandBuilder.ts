import type {
  AgentLoopCommand,
  RunningAgentLoopMachineState,
} from "./AgentLoopStateTypes.js";

export function understandTurnCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
  return {
    kind: "understand_turn",
    requestId: state.requestId,
    step: state.step,
    input: state.input,
    messages: state.messages,
    conversationEntries: state.conversationEntries,
    loadedToolNames: state.loadedToolNames,
    plannerLedger: state.plannerLedger,
  };
}

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
    activeSkills: state.activeSkills,
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

export function runPiTurnCommand(
  state: RunningAgentLoopMachineState,
  prompt: string,
): AgentLoopCommand {
  return {
    kind: "run_pi_turn",
    sessionId: state.sessionId,
    requestId: state.requestId,
    step: state.step,
    input: state.input,
    prompt,
    messages: state.messages,
    conversationEntries: state.conversationEntries,
    rootCommand: state.rootCommand,
    loadedToolNames: state.loadedToolNames,
    turnUnderstanding: state.turnUnderstanding,
    activeSkills: state.activeSkills,
  };
}
