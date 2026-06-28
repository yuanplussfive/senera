import type { ToolArtifactPolicyManifest } from "./PluginArtifactManifestTypes.js";
import type { ToolSearchManifest } from "./PluginSearchManifestTypes.js";

export interface ToolManifest {
  Name: string;
  DescriptionFile?: string;
  SignatureFile?: string;
  SignatureType?: string;
  Permissions?: string[];
  Handler?: ToolHandlerManifest;
  Search?: ToolSearchManifest;
  EvidenceCapabilities?: ToolEvidenceCapabilityManifest[];
  Artifacts?: ToolArtifactPolicyManifest;
  ArtifactPolicyFile?: string;
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
    };
