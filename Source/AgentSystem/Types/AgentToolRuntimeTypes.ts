import type { AgentMcpRuntimeEndpoint } from "../McpPackages/AgentMcpPackageTypes.js";
import type { AgentPromptContractView } from "../Prompt/AgentPromptContractTypes.js";
import type { AgentExtensionOwner } from "./AgentExtensionRuntimeTypes.js";
import type { AgentToolObservationProjectionManifest } from "./AgentToolObservationProjectionTypes.js";
import type { AgentToolContentPolicy } from "./AgentToolContentPolicyTypes.js";
import type { AgentToolPerceptionDeclaration } from "./AgentToolPerceptionTypes.js";
import type { AgentToolPresentation } from "./AgentToolPresentationTypes.js";
import type { AgentInteractionSurface } from "../Interaction/AgentInteractionContext.js";
import type {
  AgentToolDiscoverySource,
  ToolApprovalManifest,
  ToolArtifactPolicyManifest,
  AgentToolChildGrantMode,
  ToolEvidenceCapabilityManifest,
  ToolExecutionManifest,
  ToolLoadingMode,
  ToolPlanningMode,
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
  /** Omitted means the tool's contract is portable across all planner protocols. */
  planningModes?: readonly ToolPlanningMode[];
  descriptionFile?: string;
  contract?: RegisteredToolContract;
  permissions: string[];
  handler: RegisteredToolHandler;
  execution: ToolExecutionManifest;
  runtime: ToolRuntimeManifest;
  observationProjection?: AgentToolObservationProjectionManifest;
  /** Declarative ownership and content-processing policy for model observations. */
  contentPolicy?: AgentToolContentPolicy;
  perception?: AgentToolPerceptionDeclaration;
  /** Declarative workflow UI metadata inherited from the owning System domain. */
  presentation?: AgentToolPresentation;
  sources: readonly AgentToolDiscoverySource[];
  search?: ToolSearchManifest;
  childGrant: AgentToolChildGrantMode;
  evidenceCapabilities: ToolEvidenceCapabilityManifest[];
  approval?: ToolApprovalManifest;
  artifactPolicy?: ToolArtifactPolicyManifest;
  /** Explicit UI/runtime surfaces for which this tool may be exposed. Omitted means all surfaces. */
  interactionSurfaces?: readonly AgentInteractionSurface[];
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
