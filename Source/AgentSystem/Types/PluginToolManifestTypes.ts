import type { ToolArtifactPolicyManifest } from "./PluginArtifactManifestTypes.js";
import type { ToolSearchManifest } from "./PluginSearchManifestTypes.js";

export const ToolLoadingModes = {
  Bootstrap: "Bootstrap",
  Dynamic: "Dynamic",
} as const;

export type ToolLoadingMode = (typeof ToolLoadingModes)[keyof typeof ToolLoadingModes];

export interface ToolManifest {
  Name: string;
  Loading?: ToolLoadingMode;
  DescriptionFile?: string;
  Permissions?: string[];
  Handler: ToolHandlerManifest;
  Execution: ToolExecutionManifest;
  Runtime: ToolRuntimeManifest;
  Observation?: ToolObservationManifest;
  Search?: ToolSearchManifest;
  EvidenceCapabilities?: ToolEvidenceCapabilityManifest[];
  Approval?: ToolApprovalManifest;
  Artifacts?: ToolArtifactPolicyManifest;
  ArtifactPolicyFile?: string;
}

export interface ToolObservationManifest {
  MaxTokens?: number;
  IncludeArtifactProjection?: boolean;
  Continuation?: ToolObservationContinuationManifest;
}

export interface ToolObservationContinuationManifest {
  Kind: "session" | "cursor" | "offset" | "artifact";
  Handle: string;
  Cursor?: string;
  State?: string;
  TerminalStates?: string[];
}

export interface ToolRuntimeManifest {
  Lifecycle: "Immediate" | "OneShot" | "Persistent" | "RemoteJob";
  ProtocolVersion?: 2;
  Capabilities?: ToolRuntimeCapabilitiesManifest;
}

export interface ToolRuntimeCapabilitiesManifest {
  Progress?: boolean;
  OutputStreaming?: boolean;
  InteractiveInput?: boolean;
  Cancellation?: boolean;
  ResumableEvents?: boolean;
}

/**
 * Resource capabilities are registered by the host. Plugins depend on their
 * stable contract identifier instead of the projector knowing plugin-specific
 * resource kinds.
 */
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
    }
  | {
      Kind: "McpTool";
      Server: string;
      Tool: string;
      Resources?: ToolResourceArgumentManifest[];
    };
