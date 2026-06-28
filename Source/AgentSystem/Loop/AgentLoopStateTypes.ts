import type {
  AgentCompletedRunResult,
  AgentProjectedTerminalResult,
} from "../AgentExecutionProjector.js";
import type { AgentDomainEvent } from "../AgentEvent.js";
import type { AgentExecutionResult } from "../Decision/AgentDecisionExecutor.js";
import type { SanitizedDecisionXml } from "../Decision/AgentDecisionXmlSanitizer.js";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentRetryInstruction, AgentRetryableError } from "../AgentRetryableError.js";
import type { AgentDecision } from "../Types/ToolRuntimeTypes.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentModelProviderMetadata, AgentModelUsage } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentActionPlanResult } from "../ActionPlanner/AgentActionPlanner.js";
import type { AgentActionPlannerLedger } from "../ActionPlanner/AgentActionPlannerContext.js";
import type { StepTrace } from "../AgentStepTrace.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../AgentSkillActivation.js";
import type { AgentInteractionRouteResult } from "../ActionPlanner/AgentInteractionRouter.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";

export interface AgentLoopMachineConfig {
  maxSteps: number;
  maxRepairAttempts: number;
  dynamicTools: boolean;
}

export interface RunningAgentLoopMachineState {
  kind: "running";
  requestId: string;
  input: string;
  step: number;
  repairAttempts: number;
  messages: AgentLanguageModelMessage[];
  conversationEntries: AgentConversationEntry[];
  lastDecisionXml?: string;
  lastModelProvider?: AgentModelProviderMetadata;
  lastUsage?: AgentModelUsage;
  loadedToolNames: "all" | string[];
  plannerLedger: AgentActionPlannerLedger;
  rootCommand?: AgentRootCommand;
  turnUnderstanding?: TurnUnderstanding;
  toolPlanDiscoveryEscalated: boolean;
  systemPromptPreamble?: string;
  activeSkills: AgentActivatedSkill[];
  stepTraces: StepTrace[];
}

export interface CompletedAgentLoopMachineState {
  kind: "completed";
  requestId: string;
  result: AgentCompletedRunResult;
}

export interface FailedAgentLoopMachineState {
  kind: "failed";
  requestId: string;
  step: number;
  error: Error;
}

export type AgentLoopMachineState =
  | RunningAgentLoopMachineState
  | CompletedAgentLoopMachineState
  | FailedAgentLoopMachineState;

export type AgentLoopCommand =
  | {
      kind: "route_interaction";
      requestId: string;
      step: number;
      input: string;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
      turnUnderstanding?: TurnUnderstanding;
    }
  | {
      kind: "plan_action";
      requestId: string;
      step: number;
      input: string;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
      turnUnderstanding?: TurnUnderstanding;
    }
  | {
      kind: "render_prompt";
      requestId: string;
      step: number;
      input: string;
      loadedToolNames: "all" | string[];
      rootCommand?: AgentRootCommand;
      systemPromptPreamble?: string;
      activeSkills?: readonly AgentActivatedSkill[];
    }
  | {
      kind: "collect_decision_xml";
      requestId: string;
      step: number;
      prompt: string;
      messages: AgentLanguageModelMessage[];
      rootCommand?: AgentRootCommand;
      loadedToolNames: "all" | string[];
    }
  | {
      kind: "collect_tool_call_plan";
      requestId: string;
      step: number;
      input: string;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
      rootCommand: AgentRootCommand;
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
      turnUnderstanding?: TurnUnderstanding;
      activeSkills: AgentActivatedSkill[];
      toolPlanDiscoveryEscalated?: boolean;
    }
  | {
      kind: "parse_decision";
      requestId: string;
      step: number;
      responseText: string;
    }
  | {
      kind: "execute_decision";
      requestId: string;
      step: number;
      responseText: string;
      decision: AgentDecision;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
      turnUnderstanding?: TurnUnderstanding;
    }
  | {
      kind: "plan_retry";
      requestId: string;
      step: number;
      attempt: number;
      error: AgentRetryableError;
      responseText: string;
      messages: AgentLanguageModelMessage[];
    };

export type AgentLoopCommandSucceeded =
  | {
      kind: "interaction_routed";
      requestId: string;
      step: number;
      route: AgentInteractionRouteResult;
      loadedToolNames: "all" | string[];
      rootCommand?: AgentRootCommand;
      turnUnderstanding?: TurnUnderstanding;
      activeSkills: AgentActivatedSkill[];
    }
  | {
      kind: "action_planned";
      requestId: string;
      step: number;
      plan: AgentActionPlanResult;
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
      conversationEntries: AgentConversationEntry[];
      rootCommand?: AgentRootCommand;
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
      kind: "tool_calls_collected";
      requestId: string;
      step: number;
      responseText: string;
      toolCallsXml: string;
      modelProvider?: AgentModelProviderMetadata;
      usage?: AgentModelUsage;
    }
  | {
      kind: "tool_call_discovery_planned";
      requestId: string;
      step: number;
      reason: string;
      issues: string[];
      loadedToolNames: "all" | string[];
      rootCommand: AgentRootCommand;
      activeSkills: AgentActivatedSkill[];
    }
  | {
      kind: "tool_call_planning_blocked";
      requestId: string;
      step: number;
      reason: string;
      issues: string[];
      rootCommand: AgentRootCommand;
      systemPromptPreamble?: string;
    }
  | {
      kind: "final_text_collected";
      requestId: string;
      step: number;
      responseText: string;
      modelProvider: AgentModelProviderMetadata;
      usage: AgentModelUsage;
    }
  | {
      kind: "decision_parsed";
      requestId: string;
      step: number;
      responseText: string;
      decision: AgentDecision;
      sanitized: SanitizedDecisionXml;
    }
  | {
      kind: "tool_results_generated";
      requestId: string;
      step: number;
      responseText: string;
      execution: Extract<AgentExecutionResult, { kind: "ToolResults" }>;
      resultXml: string;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
    }
  | {
      kind: "terminal_projected";
      requestId: string;
      step: number;
      projected: AgentProjectedTerminalResult;
    }
  | {
      kind: "retry_planned";
      requestId: string;
      step: number;
      attempt: number;
      instruction: AgentRetryInstruction;
      responseText: string;
      repairedMessages: AgentLanguageModelMessage[];
    };

export type AgentLoopCommandResult =
  | {
      kind: "succeeded";
      output: AgentLoopCommandSucceeded;
    }
  | {
      kind: "retryable_failed";
      requestId: string;
      step: number;
      error: AgentRetryableError;
      responseText: string;
    };

export interface AgentLoopTransition {
  state: AgentLoopMachineState;
  command?: AgentLoopCommand;
  events: AgentDomainEvent[];
}
