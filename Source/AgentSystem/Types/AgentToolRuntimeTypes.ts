import type { AgentMcpRuntimeEndpoint } from "../McpPackages/AgentMcpPackageTypes.js";
import type { AgentPromptContractView } from "../Prompt/AgentPromptContractTypes.js";
import type { AgentExtensionOwner } from "./AgentExtensionRuntimeTypes.js";
import type { AgentToolObservationProjectionManifest } from "./AgentToolObservationProjectionTypes.js";
import type {
  AgentToolDiscoverySource,
  ToolApprovalManifest,
  ToolArtifactPolicyManifest,
  AgentToolChildGrantMode,
  ToolEvidenceCapabilityManifest,
  ToolExecutionManifest,
  ToolLoadingMode,
  ToolResourceArgumentManifest,
  ToolRuntimeManifest,
  ToolSearchManifest,
} from "./AgentToolContractTypes.js";

export type RegisteredToolHandler =
  | {
      kind: "HostCapability";
      capability: string;
      resources?: readonly ToolResourceArgumentManifest[];
    }
  | {
      kind: "McpTool";
      server: AgentMcpRuntimeEndpoint;
      tool: string;
      readOnly: boolean;
      resources?: readonly ToolResourceArgumentManifest[];
    };

export interface RegisteredToolContract {
  readonly digest: string;
  readonly arguments?: AgentPromptContractView;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
}

export interface RegisteredTool {
  owner: AgentExtensionOwner;
  name: string;
  loading: ToolLoadingMode;
  descriptionFile?: string;
  contract?: RegisteredToolContract;
  permissions: string[];
  handler: RegisteredToolHandler;
  execution: ToolExecutionManifest;
  runtime: ToolRuntimeManifest;
  observationProjection?: AgentToolObservationProjectionManifest;
  sources: readonly AgentToolDiscoverySource[];
  search?: ToolSearchManifest;
  childGrant: AgentToolChildGrantMode;
  evidenceCapabilities: ToolEvidenceCapabilityManifest[];
  approval?: ToolApprovalManifest;
  artifactPolicy?: ToolArtifactPolicyManifest;
}

/**
 * A model-call schema owned by an extension but reserved for an internal
 * runtime sidecar. Unlike RegisteredTool, it is never exposed to the main
 * agent, tool search, approval flow, or normal tool execution runtime.
 */
export interface RegisteredSidecarTool {
  readonly owner: AgentExtensionOwner;
  readonly name: string;
  readonly capability: string;
  readonly description: string;
  readonly instructions: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface RegisteredTemplate {
  name: string;
  path: string;
  description?: string;
  exposeToPi: boolean;
  search?: ToolSearchManifest;
}
