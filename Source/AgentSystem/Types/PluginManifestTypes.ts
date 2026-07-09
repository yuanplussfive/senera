import type {
  PluginEntryManifest,
  PluginKind,
  PluginPromptingManifest,
  PluginMcpServerManifest,
  PluginRuntimeManifest,
  PluginSandboxManifest,
  PluginSecurityManifest,
  PromptManifest,
  TemplateManifest,
} from "./PluginManifestSharedTypes.js";
import type { RootCommandManifest } from "./PluginRootCommandManifestTypes.js";
import type { SkillManifest } from "./PluginSkillManifestTypes.js";
import type { ToolManifest } from "./PluginToolManifestTypes.js";

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
  ToolArtifactSummaryManifest,
  ToolArtifactWorkspaceManifest,
  ToolArtifactWorkspacePathManifest,
} from "./PluginArtifactManifestTypes.js";
export type {
  PluginEntryManifest,
  PluginKind,
  PluginPromptingManifest,
  PluginMcpServerManifest,
  PluginRootKind,
  PluginRuntimeManifest,
  PluginSandboxManifest,
  PluginSecurityManifest,
  PromptManifest,
  TemplateManifest,
} from "./PluginManifestSharedTypes.js";
export type {
  RootCommandManifest,
  RootCommandToolSelectorManifest,
  RootCommandVisibleOutputManifest,
  RootCommandVisibleOutputRepairManifest,
  RootCommandVisibleOutputRuleManifest,
} from "./PluginRootCommandManifestTypes.js";
export type {
  ToolSearchCapabilityFacetsManifest,
  ToolSearchCapabilityManifest,
  ToolSearchCapabilityRiskManifest,
  ToolSearchManifest,
} from "./PluginSearchManifestTypes.js";
export type {
  SkillEvidenceRequirementManifest,
  SkillManifest,
} from "./PluginSkillManifestTypes.js";
export type {
  ToolApprovalManifest,
  ToolEvidenceCapabilityManifest,
  ToolExecutionManifest,
  ToolHandlerManifest,
  ToolManifest,
} from "./PluginToolManifestTypes.js";

export interface PluginManifest {
  Plugin: {
    Name: string;
    Title?: string;
    Version: string;
    Kind: PluginKind;
    Description?: string;
    Entry?: PluginEntryManifest;
  };
  Compatibility?: Record<string, unknown>;
  Tools?: ToolManifest[];
  McpServers?: PluginMcpServerManifest[];
  Skills?: SkillManifest[];
  Resources?: unknown[];
  Prompts?: PromptManifest[];
  Templates?: TemplateManifest[];
  RootCommands?: RootCommandManifest[];
  Runtime?: PluginRuntimeManifest;
  Sandbox?: PluginSandboxManifest;
  Security?: PluginSecurityManifest;
  Prompting?: PluginPromptingManifest;
}
