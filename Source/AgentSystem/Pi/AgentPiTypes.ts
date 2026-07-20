import type { AgentToolResult, AgentToolUpdateCallback, AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";

export type AgentPiToolDetails = {
  senera: {
    toolName: string;
    artifactUri?: string;
    callId?: string;
  };
};

export type AgentPiToolSchema = TSchema & Record<string, unknown>;
export type AgentPiToolDefinition = AgentTool<AgentPiToolSchema, AgentPiToolDetails>;
export type AgentPiToolResult = AgentToolResult<AgentPiToolDetails>;
export type AgentPiToolUpdate = AgentToolUpdateCallback<AgentPiToolDetails>;

export interface AgentPiToolProjectionContext {
  sessionId?: string;
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  visibleToolNames?: "all" | readonly string[];
  piProxyRuntimeContextId?: string;
  signal?: AbortSignal;
  activeSkills?: readonly AgentActivatedSkill[];
  rootCommand?: AgentRootCommand;
  turnUnderstanding?: TurnUnderstanding;
}

export interface AgentPiToolExecutionInput {
  tool: RegisteredTool;
  toolCallId: string;
  params: Record<string, unknown>;
  signal?: AbortSignal;
  context: AgentPiToolProjectionContext;
}

export type AgentPiModelApi = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

export interface AgentPiModelProjection {
  id: string;
  name: string;
  api: AgentPiModelApi;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: {
    supportsDeveloperRole?: boolean;
  };
}

export interface AgentPiProviderProjection {
  providerId: string;
  apiKey: string;
  headers: Record<string, string>;
  upstream: {
    providerId: string;
    endpoint: string;
    baseUrl: string;
    model: string;
  };
  model: AgentPiModelProjection;
}
