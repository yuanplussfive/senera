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
  ToolArtifactWorkspacePathManifest,
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

export const AgentHostToolProtocolVersion = 2 as const;

export const ToolResultAssessmentPolicies = {
  ProcessExit: "ProcessExit",
  Unassessed: "Unassessed",
} as const;

export type ToolResultAssessmentPolicy =
  (typeof ToolResultAssessmentPolicies)[keyof typeof ToolResultAssessmentPolicies];

export interface ToolRuntimeManifest {
  Lifecycle: "Immediate" | "OneShot" | "Persistent" | "RemoteJob";
  ProtocolVersion?: typeof AgentHostToolProtocolVersion;
  ResultAssessment: ToolResultAssessmentPolicy;
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
