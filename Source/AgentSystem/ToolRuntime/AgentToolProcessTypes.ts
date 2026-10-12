import type {
  AgentToolProcessResponse,
  AgentWorkspaceMutationReceipt,
  AgentWorkspaceObservationLeaseSignal,
  ToolWorkspaceCaptureResult,
} from "../Types/ToolRuntimeTypes.js";
import type { AgentToolArtifactPayload } from "../Types/ToolRuntimeTypes.js";
import type { SeneraOutputSpoolDescriptor } from "../Execution/SeneraOutputSpool.js";
export interface AgentToolProcessRunResult {
  response: AgentToolProcessResponse;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  artifactPayload?: AgentToolArtifactPayload;
  /** Internal provider-shape value used for contract validation before projection. */
  validationResult?: unknown;
  outputCapture?: SeneraOutputSpoolDescriptor;
  /** Host-only mutation proof consumed by workspace ChangeSet capture. */
  workspaceMutationReceipt?: AgentWorkspaceMutationReceipt;
  /** Host-only observation result captured for a resource-backed process. */
  workspaceCapture?: ToolWorkspaceCaptureResult;
  /** Host-only lifecycle signal for a resource-backed workspace observation. */
  workspaceObservation?: AgentWorkspaceObservationLeaseSignal;
}
