import type { LoadedPluginConfig } from "./PluginConfigTypes.js";
import type {
  PluginManifest,
  PluginRootKind,
  SkillEvidenceRequirementManifest,
  ToolArtifactPolicyManifest,
  ToolEvidenceCapabilityManifest,
  ToolExecutionManifest,
  ToolRuntimeManifest,
  ToolObservationManifest,
  ToolApprovalManifest,
  ToolSearchManifest,
  ToolLoadingMode,
  ToolResourceArgumentManifest,
} from "./PluginManifestTypes.js";
import type { AgentPromptContractView } from "../Prompt/AgentPromptContractTypes.js";

export type RegisteredToolHandler =
  | {
      kind: "HostCapability";
      capability: string;
    }
  | {
      kind: "McpTool";
      server: string;
      tool: string;
      resources: readonly ToolResourceArgumentManifest[];
    };

export interface RegisteredToolContract {
  readonly digest: string;
  readonly arguments?: AgentPromptContractView;
}

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
  loading: ToolLoadingMode;
  descriptionFile?: string;
  signatureFile?: string;
  signatureType?: string;
  contract?: RegisteredToolContract;
  permissions: string[];
  handler: RegisteredToolHandler;
  execution: ToolExecutionManifest;
  runtime: ToolRuntimeManifest;
  observation?: ToolObservationManifest;
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
