import type { AgentInteractionRouteResult } from "../ActionPlanner/AgentInteractionRouter.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";

export type AgentPiAssistantMessageKind = "final_text" | "tool_calls";

export interface AgentPiAssistantToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentPiAssistantMessage {
  kind: AgentPiAssistantMessageKind;
  content: string;
  toolCalls: AgentPiAssistantToolCall[];
}

export interface AgentPiFinalAnswerInput {
  openAiRequest: Pick<
    AgentPiAssistantMessageCompileInput["openAiRequest"],
    "model" | "messages" | "toolTranscript" | "projection"
  >;
  seneraRuntime: AgentPiAssistantMessageCompileInput["seneraRuntime"];
  answerPlan: string[];
}

export type AgentPiAssistantCompilation =
  | AgentPiAssistantMessage
  | {
      kind: "final_answer";
      decisionSource: "model" | "runtime" | "preparation";
      input: AgentPiFinalAnswerInput;
    };

export interface AgentPiAssistantMessageCompileInput {
  openAiRequest: {
    model: string;
    messages: unknown[];
    toolTranscript: AgentPiToolTranscriptItem[];
    toolChoice?: unknown;
    parallelToolCalls?: boolean;
    temperature?: number;
    maxTokens?: number;
    stream: boolean;
    projection: {
      originalMessageCount: number;
      projectedMessageCount: number;
      omittedOlderMessages: number;
      truncatedTextFields: number;
      truncatedJsonFields: number;
      planningInputTokenBudget: number;
    };
  };
  seneraRuntime: {
    modelProviderId: string;
    model: string;
    rootCommand?: AgentRootCommand;
    interactionRoute?: AgentInteractionRouteResult;
    turnUnderstanding?: TurnUnderstanding;
    activeSkills?: unknown[];
  };
}

export interface AgentPiToolTranscriptItem {
  callId: string;
  toolName: string;
  argumentsJson: string;
  observation?: {
    status: "success" | "failure" | "empty" | "unknown";
    summary?: string;
    artifactUri?: string;
    evidenceUris: string[];
  };
}

export interface AgentPiToolParameterOutlineProperty {
  path: string;
  types: string[];
  required: boolean;
  description?: string;
  allowedValues?: unknown[];
}

export type AgentPiToolParameterContract =
  | {
      format: "json_schema";
      schema: unknown;
    }
  | {
      format: "json_schema_outline";
      rootTypes: string[];
      properties: AgentPiToolParameterOutlineProperty[];
      omittedProperties: number;
    };

export interface AgentPiToolCard {
  name: string;
  description?: string;
  parameterContract: AgentPiToolParameterContract;
}

export interface AgentPiToolContract {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface AgentPiControllerActionInput extends AgentPiAssistantMessageCompileInput {
  candidateTools: AgentPiToolCard[];
}

export interface AgentPiPlannedToolCall {
  toolName: string;
  purpose: string;
  required: boolean;
  dependsOn?: number[];
  argumentHints?: Record<string, unknown>;
}

export interface AgentPiToolArgumentsInput {
  openAiRequest: AgentPiAssistantMessageCompileInput["openAiRequest"];
  call: AgentPiPlannedToolCall & {
    planIndex: number;
  };
  tool: AgentPiToolContract;
  seneraRuntime: AgentPiAssistantMessageCompileInput["seneraRuntime"];
}

export interface AgentPiToolArgumentsRepairInput extends AgentPiToolArgumentsInput {
  invalidArguments: unknown;
  issues: string[];
}
