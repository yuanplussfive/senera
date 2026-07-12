import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import { buildInitialActionPlannerLedger } from "../ActionPlanner/AgentActionPlannerContext.js";
import type { RunningAgentLoopMachineState } from "./AgentLoopStateTypes.js";

export interface AgentLoopStartRequest {
  sessionId?: string;
  requestId: string;
  input: string;
  messages?: AgentLanguageModelMessage[];
  conversationEntries?: AgentConversationEntry[];
  loadedToolNames: "all" | string[];
  rootCommand?: AgentRootCommand;
  systemPromptPreamble?: string;
  emitRunStarted?: boolean;
}

export function createInitialAgentLoopState(request: AgentLoopStartRequest): RunningAgentLoopMachineState {
  const fallbackMessages: AgentLanguageModelMessage[] = [
    {
      role: "user",
      content: request.input,
    },
  ];

  return {
    kind: "running",
    sessionId: request.sessionId,
    requestId: request.requestId,
    input: request.input,
    step: 1,
    messages: request.messages && request.messages.length > 0 ? request.messages : fallbackMessages,
    conversationEntries: [...(request.conversationEntries ?? [])],
    loadedToolNames: request.loadedToolNames,
    plannerLedger: buildInitialActionPlannerLedger(request.messages),
    rootCommand: request.rootCommand,
    systemPromptPreamble: request.systemPromptPreamble,
    activeSkills: [],
    stepTraces: [],
  };
}
