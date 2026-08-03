import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentToolExposureSnapshot } from "../ToolRuntime/AgentToolExposureState.js";
import type { AgentPiToolObservationStatus } from "./AgentPiToolObservationStatus.js";
import type { AgentToolOutputAvailability } from "../ToolRuntime/AgentToolResultOutcome.js";
import type { AgentPiContextPolicyProtocol } from "./AgentPiContextPolicyProtocol.js";

export interface AgentPiPlanningEvidenceRequirement {
  readonly Need: string;
  readonly Accepts: readonly string[];
  readonly MinimumQuality?: readonly string[];
  readonly Minimum?: number;
  readonly Purpose?: string;
}

export interface AgentPiPlanningSkill {
  readonly name: string;
  readonly title: string;
  readonly summary: string;
  readonly useCases: readonly string[];
  readonly avoid: readonly string[];
  readonly recommendedTools: readonly string[];
  readonly evidenceRequirements: readonly AgentPiPlanningEvidenceRequirement[];
}

export function projectAgentPiPlanningSkills(skills: readonly AgentPiPlanningSkill[]): AgentPiPlanningSkill[] {
  return skills.map((skill) => ({
    name: skill.name,
    title: skill.title,
    summary: skill.summary,
    useCases: [...skill.useCases],
    avoid: [...skill.avoid],
    recommendedTools: [...skill.recommendedTools],
    evidenceRequirements: skill.evidenceRequirements.map((requirement) => ({
      ...requirement,
      Accepts: [...requirement.Accepts],
      MinimumQuality: requirement.MinimumQuality ? [...requirement.MinimumQuality] : undefined,
    })),
  }));
}

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

export type AgentPiAssistantCompilation = AgentPiAssistantMessage;

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
      hasCompactionBoundary: boolean;
    };
  };
  seneraRuntime: {
    protocols: {
      contextPolicy: typeof AgentPiContextPolicyProtocol;
    };
    modelProviderId: string;
    model: string;
    toolAccessGrant: AgentToolAccessGrant;
    toolExposure: AgentToolExposureSnapshot;
    rootCommand?: AgentRootCommand;
    activeSkills?: readonly AgentPiPlanningSkill[];
    planState?: AgentPiToolPlanState;
    conversationSummaryText?: string;
  };
}

export interface AgentPiToolPlanState {
  revisions: AgentPiToolPlanRevision[];
}

export interface AgentPiToolPlanRevision {
  planId: string;
  revision: number;
  nodes: AgentPiToolPlanStateNode[];
}

export interface AgentPiToolPlanStateNode {
  nodeId: string;
  planIndex: number;
  toolName: string;
  dependencyNodeIds: string[];
  status: "planned" | "dispatched" | "completed" | "failed" | "blocked";
  assessment?: AgentPiToolObservationStatus;
  callId?: string;
  failure?: string;
}

export interface AgentPiToolTranscriptItem {
  callId: string;
  toolName: string;
  argumentsJson: string;
  observation?: {
    status: AgentPiToolObservationStatus;
    outputAvailability: AgentToolOutputAvailability;
    summary?: string;
    artifactUri?: string;
    evidenceUris: string[];
    error?: {
      code?: string;
      kind?: string;
      source?: string;
      retryable?: boolean;
      message?: string;
    };
  };
}

export interface AgentPiToolRoutingCard {
  name: string;
  summary: string;
  inputs: string[];
  outputs: string[];
  effects: string[];
}

export interface AgentPiToolContract {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface AgentPiControllerDecisionInput extends AgentPiAssistantMessageCompileInput {
  routingCards: AgentPiToolRoutingCard[];
}

export interface AgentPiPlannedToolCall {
  toolName: string;
  purpose: string;
  required: boolean;
  dependsOn?: number[];
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
