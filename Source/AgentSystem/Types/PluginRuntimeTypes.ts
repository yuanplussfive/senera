import type { LoadedPluginConfig } from "./PluginConfigTypes.js";
import type {
  PluginManifest,
  PluginRootKind,
  SkillEvidenceRequirementManifest,
  ToolArtifactPolicyManifest,
  ToolEvidenceCapabilityManifest,
  ToolExecutionManifest,
  ToolApprovalManifest,
  ToolSearchManifest,
} from "./PluginManifestTypes.js";

export type RegisteredToolHandler =
  | {
      kind: "PluginProcess";
    }
  | {
      kind: "HostCapability";
      capability: string;
    }
  | {
      kind: "McpTool";
      server: string;
      tool: string;
    };

export interface LoadedPlugin {
  rootPath: string;
  rootKind: PluginRootKind;
  manifestPath: string;
  config: LoadedPluginConfig;
  manifest: PluginManifest;
}

export interface RegisteredTool {
  plugin: LoadedPlugin;
  name: string;
  descriptionFile?: string;
  signatureFile?: string;
  signatureType?: string;
  permissions: string[];
  handler: RegisteredToolHandler;
  execution: ToolExecutionManifest;
  search?: ToolSearchManifest;
  evidenceCapabilities: ToolEvidenceCapabilityManifest[];
  approval?: ToolApprovalManifest;
  artifactPolicy?: ToolArtifactPolicyManifest;
}

export interface RegisteredSkill {
  plugin: LoadedPlugin;
  name: string;
  title?: string;
  descriptionFile: string;
  recommendedTools: string[];
  evidenceRequirements: SkillEvidenceRequirementManifest[];
  search?: ToolSearchManifest;
}

export interface RegisteredTemplate {
  plugin: LoadedPlugin;
  name: string;
  path: string;
  description?: string;
  exposeToPi: boolean;
  search?: ToolSearchManifest;
}
