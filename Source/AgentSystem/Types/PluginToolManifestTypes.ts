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
  SignatureFile?: string;
  SignatureType?: string;
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

export type ToolResourceAccessIntentManifest = "inspect" | "read" | "create" | "replace" | "remove" | "execute";

export interface ToolResourceIntentCaseManifest {
  Equals: string | number | boolean | null;
  Intent: ToolResourceAccessIntentManifest;
}

export type ToolResourceIntentManifest =
  | ToolResourceAccessIntentManifest
  | {
      Selector: string;
      Cases: ToolResourceIntentCaseManifest[];
      Default: ToolResourceAccessIntentManifest;
    };

export interface ToolResourceArgumentManifest {
  Pointer: string;
  Intent: ToolResourceIntentManifest;
}

export interface ToolApprovalManifest {
  Mode: "allow" | "ask" | "deny";
  Reason?: string;
}

export interface ToolExecutionManifest {
  Boundary: "Local" | "Sandbox" | "SandboxPreferred";
  Network: "Allow" | "Deny";
  Workspace: "ReadOnly" | "ReadWrite";
  LocalFallback: "Allow" | "Deny";
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
