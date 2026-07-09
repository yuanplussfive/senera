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

export interface AgentPiAssistantMessageCompileInput {
  openAiRequest: {
    model: string;
    messages: unknown[];
    tools: unknown[];
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
  allowedTools: string[];
  seneraRuntime: {
    modelProviderId: string;
    model: string;
    rootCommand?: unknown;
    activeSkills?: unknown[];
  };
}

export interface AgentPiToolTranscriptItem {
  callId: string;
  toolName: string;
  argumentsJson: string;
  observation?: {
    status: "success" | "failure" | "empty" | "unknown";
    content: string;
    summary?: string;
    artifactUri?: string;
    evidenceUris: string[];
  };
}

export interface AgentPiToolCard {
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
  tool: AgentPiToolCard;
  seneraRuntime: AgentPiAssistantMessageCompileInput["seneraRuntime"];
}

export interface AgentPiToolArgumentsRepairInput extends AgentPiToolArgumentsInput {
  invalidArguments: unknown;
  issues: string[];
}
