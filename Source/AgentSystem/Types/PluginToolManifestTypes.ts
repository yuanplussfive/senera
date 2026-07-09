import type { ToolArtifactPolicyManifest } from "./PluginArtifactManifestTypes.js";
import type { ToolSearchManifest } from "./PluginSearchManifestTypes.js";

export interface ToolManifest {
  Name: string;
  DescriptionFile?: string;
  SignatureFile?: string;
  SignatureType?: string;
  Permissions?: string[];
  Handler?: ToolHandlerManifest;
  Execution: ToolExecutionManifest;
  Search?: ToolSearchManifest;
  EvidenceCapabilities?: ToolEvidenceCapabilityManifest[];
  Approval?: ToolApprovalManifest;
  Artifacts?: ToolArtifactPolicyManifest;
  ArtifactPolicyFile?: string;
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
      Kind: "PluginProcess";
    }
  | {
      Kind: "HostCapability";
      Capability: string;
    }
  | {
      Kind: "McpTool";
      Server: string;
      Tool: string;
    };
