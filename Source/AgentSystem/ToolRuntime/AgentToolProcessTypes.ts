import type { AgentToolProcessResponse } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolArtifactPayload } from "../Types/ToolRuntimeTypes.js";
import type { SeneraOutputSpoolDescriptor } from "../Execution/SeneraOutputSpool.js";
import type { AgentToolSemanticProjectionRequest } from "./AgentToolSemanticProjection.js";
export interface AgentToolProcessRunResult {
  response: AgentToolProcessResponse;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  artifactPayload?: AgentToolArtifactPayload;
  outputCapture?: SeneraOutputSpoolDescriptor;
  semanticProjectionRequest?: AgentToolSemanticProjectionRequest;
}
