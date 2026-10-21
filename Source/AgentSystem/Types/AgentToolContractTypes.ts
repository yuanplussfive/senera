import type { ToolArtifactPolicyManifest } from "./AgentArtifactContractTypes.js";
import type { ToolSearchManifest } from "./AgentToolSearchContractTypes.js";

export type {
  ToolArtifactConditionManifest,
  ToolArtifactEvidenceIdentityManifest,
  ToolArtifactEvidenceIdentityPartManifest,
  ToolArtifactEvidenceManifest,
  ToolArtifactEvidenceModelProjectionManifest,
  ToolArtifactEvidencePlannerMemoryManifest,
  ToolArtifactEvidencePresentationManifest,
  ToolArtifactEvidenceProjectionManifest,
  ToolArtifactEvidenceSlotManifest,
  ToolArtifactEvidenceSlotObjectManifest,
  ToolArtifactEvidenceSlotScope,
  ToolArtifactPolicyManifest,
  ToolArtifactRedactionManifest,
  ToolArtifactRedactionTransformManifest,
  ToolArtifactSummaryManifest,
  ToolArtifactWorkspaceManifest,
} from "./AgentArtifactContractTypes.js";
export type {
  RootCommandManifest,
  RootCommandToolSelectorManifest,
  RootCommandVisibleOutputManifest,
  RootCommandVisibleOutputRepairManifest,
  RootCommandVisibleOutputRuleManifest,
} from "./AgentRootCommandContractTypes.js";
export type {
  ToolSearchCapabilityFacetsManifest,
  ToolSearchCapabilityManifest,
  ToolSearchCapabilityRiskManifest,
  ToolSearchManifest,
} from "./AgentToolSearchContractTypes.js";

export interface AgentToolDiscoverySource {
  Id: string;
  Title: string;
  Description: string;
}

export const ToolLoadingModes = {
  Bootstrap: "Bootstrap",
  Dynamic: "Dynamic",
} as const;

export type ToolLoadingMode = (typeof ToolLoadingModes)[keyof typeof ToolLoadingModes];

/**
 * A planner protocol controls how a provider receives and executes tool
 * schemas. This is separate from Loading: Loading selects direct versus
 * discovery invocation, while PlanningModes declares which protocols can
 * faithfully represent that contract.
 */
export const ToolPlanningModes = ["native", "baml"] as const;

export type ToolPlanningMode = (typeof ToolPlanningModes)[number];

export const AgentToolChildGrantModes = {
  Inherit: "inherit",
  Internal: "internal",
  Delegation: "delegation",
} as const;

export type AgentToolChildGrantMode = (typeof AgentToolChildGrantModes)[keyof typeof AgentToolChildGrantModes];

export const AgentHostToolProtocolVersion = 2 as const;

export const ToolResultAssessmentPolicies = {
  ProcessExit: "ProcessExit",
  Unassessed: "Unassessed",
} as const;

export type ToolResultAssessmentPolicy =
  (typeof ToolResultAssessmentPolicies)[keyof typeof ToolResultAssessmentPolicies];

export const ToolSchedulingModes = {
  Parallel: "Parallel",
  ResourceClaims: "ResourceClaims",
  SelfManaged: "SelfManaged",
} as const;

export type ToolSchedulingMode = (typeof ToolSchedulingModes)[keyof typeof ToolSchedulingModes];

/**
 * Declares how the host deadline is owned by a tool. Model-aware tools may
 * extend the initial host budget after resolving the request budget they
 * actually use; all other tools remain bounded by ToolExecution.Timeout.
 */
export const ToolDeadlinePolicies = {
  Configured: "Configured",
  ModelAware: "ModelAware",
} as const;

export type ToolDeadlinePolicy = (typeof ToolDeadlinePolicies)[keyof typeof ToolDeadlinePolicies];

/**
 * Controls whether a tool result creates a new durable Artifact or is a
 * bounded view over an Artifact that already exists.
 */
export const ToolResultStorageModes = {
  Artifact: "Artifact",
  SourceView: "SourceView",
} as const;

export type ToolResultStorageMode = (typeof ToolResultStorageModes)[keyof typeof ToolResultStorageModes];

export interface ToolRuntimeManifest {
  Lifecycle: "Immediate" | "OneShot" | "Persistent" | "RemoteJob";
  ProtocolVersion?: typeof AgentHostToolProtocolVersion;
  ResultAssessment: ToolResultAssessmentPolicy;
  /** Optional request-aware deadline policy for host-owned execution. */
  DeadlinePolicy?: ToolDeadlinePolicy;
  /** Omitted means the tool publishes a new durable Artifact. */
  ResultStorage?: ToolResultStorageMode;
  Scheduling?: ToolSchedulingMode;
  MaxConcurrency?: number;
  Capabilities?: ToolRuntimeCapabilitiesManifest;
}

export interface ToolRuntimeCapabilitiesManifest {
  Progress?: boolean;
  OutputStreaming?: boolean;
  InteractiveInput?: boolean;
  Cancellation?: boolean;
  ResumableEvents?: boolean;
}

export interface ToolResourceArgumentManifest {
  Capability: string;
  Pointer: string;
  Binding?: string;
  Parameters?: Record<string, unknown>;
}

export interface ToolApprovalManifest {
  Mode: "allow" | "ask" | "deny";
  Reason?: string;
}

export const ToolExecutionTargets = {
  Sandbox: "Sandbox",
  Local: "Local",
} as const;

export type ToolExecutionTarget = (typeof ToolExecutionTargets)[keyof typeof ToolExecutionTargets];

export interface ToolExecutionManifest {
  Targets: ToolExecutionTarget[];
  Network: "Allow" | "Deny";
  Workspace: "ReadOnly" | "ReadWrite";
}

export interface ToolEvidenceCapabilityManifest {
  Produces: string;
  Quality: string;
  Satisfies?: string[];
  Kinds?: string[];
  CapabilityIds?: string[];
}

export type ToolHandlerManifest =
  | {
      Kind: "HostCapability";
      Capability: string;
      Resources?: ToolResourceArgumentManifest[];
    }
  | {
      Kind: "McpTool";
      Server: string;
      Tool: string;
      Resources?: ToolResourceArgumentManifest[];
    };

export interface ToolManifest {
  Name: string;
  Loading?: ToolLoadingMode;
  PlanningModes?: ToolPlanningMode[];
  DescriptionFile?: string;
  Permissions?: string[];
  Handler: ToolHandlerManifest;
  Execution: ToolExecutionManifest;
  Runtime: ToolRuntimeManifest;
  Search?: ToolSearchManifest;
  EvidenceCapabilities?: ToolEvidenceCapabilityManifest[];
  Approval?: ToolApprovalManifest;
  Artifacts?: ToolArtifactPolicyManifest;
  ArtifactPolicyFile?: string;
}
