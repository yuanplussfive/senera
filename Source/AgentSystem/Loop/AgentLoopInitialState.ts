import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import { buildInitialActionPlannerLedger } from "../ActionPlanner/AgentActionPlannerContext.js";
import type { RunningAgentLoopMachineState } from "./AgentLoopStateTypes.js";
import type { AgentTurnPreparationSnapshot } from "./AgentTurnPreparationSnapshot.js";

export interface AgentLoopStartRequest {
  sessionId?: string;
  requestId: string;
  input: string;
  messages?: AgentLanguageModelMessage[];
  conversationEntries?: AgentConversationEntry[];
  loadedToolNames: string[];
  rootCommand?: AgentRootCommand;
  systemPromptPreamble?: string;
  emitRunStarted?: boolean;
  preparation?: AgentTurnPreparationSnapshot;
  onPiBranchBoundary?: (entryId: string) => void | Promise<void>;
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
    loadedToolNames: request.preparation?.loadedToolNames ?? request.loadedToolNames,
    plannerLedger: buildInitialActionPlannerLedger(request.messages),
    rootCommand: request.preparation?.rootCommand ?? request.rootCommand,
    interactionRoute: request.preparation?.route,
    turnUnderstanding: request.preparation?.turnUnderstanding,
    initialAction: request.preparation?.initialAction,
    systemPromptPreamble: request.systemPromptPreamble,
    activeSkills: request.preparation?.activeSkills.map((skill) => structuredClone(skill)) ?? [],
    stepTraces: [],
    onPiBranchBoundary: request.onPiBranchBoundary,
  };
}
