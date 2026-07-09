import type { AgentToolProcessRequest } from "../Types/ToolRuntimeTypes.js";

export const AgentToolProcessRequestEnvelope = {
  Type: "tool_request",
  Version: 1,
} as const;

export type AgentToolProcessRequestType = typeof AgentToolProcessRequestEnvelope.Type;
export type AgentToolProcessRequestVersion = typeof AgentToolProcessRequestEnvelope.Version;

export interface AgentToolProcessRequestEnvelopeDocument {
  type: AgentToolProcessRequestType;
  version: AgentToolProcessRequestVersion;
  tool: string;
  arguments: Record<string, unknown>;
  context: AgentToolProcessRequest["context"];
}

export function createToolProcessRequestEnvelope(
  request: AgentToolProcessRequest,
): AgentToolProcessRequestEnvelopeDocument {
  return {
    type: AgentToolProcessRequestEnvelope.Type,
    version: AgentToolProcessRequestEnvelope.Version,
    tool: request.tool,
    arguments: request.arguments,
    context: request.context,
  };
}
