import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentModelProviderMetadata, AgentModelUsage } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentActionPlannerLedger } from "../ActionPlanner/AgentActionPlannerContext.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { AgentInteractionRouteResult } from "../ActionPlanner/AgentInteractionRouter.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentCompletedRunResult } from "../Runtime/AgentExecutionProjector.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type { ParsedPiControllerAction } from "../PiProxy/AgentPiAssistantMessageSchema.js";

export interface RunningAgentLoopMachineState {
  kind: "running";
  sessionId?: string;
  requestId: string;
  input: string;
  step: number;
  messages: AgentLanguageModelMessage[];
  conversationEntries: AgentConversationEntry[];
  loadedToolNames: string[];
  plannerLedger: AgentActionPlannerLedger;
  rootCommand?: AgentRootCommand;
  interactionRoute?: AgentInteractionRouteResult;
  turnUnderstanding?: TurnUnderstanding;
  initialAction?: ParsedPiControllerAction;
  systemPromptPreamble?: string;
  activeSkills: AgentActivatedSkill[];
  stepTraces: StepTrace[];
  onPiBranchBoundary?: (entryId: string) => void | Promise<void>;
}

export interface CompletedAgentLoopMachineState {
  kind: "completed";
  requestId: string;
  result: AgentCompletedRunResult;
}

export type AgentLoopMachineState = RunningAgentLoopMachineState | CompletedAgentLoopMachineState;

export type AgentLoopCommand =
  | {
      kind: "prepare_interaction";
      requestId: string;
      step: number;
      input: string;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
      loadedToolNames: string[];
      plannerLedger: AgentActionPlannerLedger;
    }
  | {
      kind: "render_prompt";
      requestId: string;
      step: number;
      input: string;
      loadedToolNames: string[];
      rootCommand?: AgentRootCommand;
      systemPromptPreamble?: string;
      activeSkills?: readonly AgentActivatedSkill[];
    }
  | {
      kind: "run_pi_turn";
      sessionId?: string;
      requestId: string;
      step: number;
      input: string;
      prompt: string;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
      rootCommand?: AgentRootCommand;
      loadedToolNames: string[];
      turnUnderstanding?: TurnUnderstanding;
      interactionRoute?: AgentInteractionRouteResult;
      initialAction?: ParsedPiControllerAction;
      activeSkills: AgentActivatedSkill[];
      onPiBranchBoundary?: (entryId: string) => void | Promise<void>;
    };

export type AgentLoopCommandSucceeded =
  | {
      kind: "interaction_prepared";
      requestId: string;
      step: number;
      route: AgentInteractionRouteResult;
      loadedToolNames: string[];
      rootCommand?: AgentRootCommand;
      initialAction: ParsedPiControllerAction;
      turnUnderstanding?: TurnUnderstanding;
      activeSkills: AgentActivatedSkill[];
    }
  | {
      kind: "prompt_rendered";
      requestId: string;
      step: number;
      prompt: string;
      promptTokenCount: number;
    }
  | {
      kind: "pi_turn_completed";
      requestId: string;
      step: number;
      responseText: string;
      modelProvider: AgentModelProviderMetadata;
      usage: AgentModelUsage;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
      stepTraces: StepTrace[];
      executedTools: ExecutedToolCallResult[];
    };

export type AgentLoopCommandResult = {
  kind: "succeeded";
  output: AgentLoopCommandSucceeded;
};

export interface AgentLoopTransition {
  state: AgentLoopMachineState;
  command?: AgentLoopCommand;
  events: AgentDomainEvent[];
}
