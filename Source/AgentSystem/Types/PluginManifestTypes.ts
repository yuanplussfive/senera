import type {
  PluginKind,
  PluginPromptingManifest,
  PluginMcpServerManifest,
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
  ToolArtifactRedactionTransformManifest,
  ToolArtifactSummaryManifest,
  ToolArtifactWorkspaceManifest,
  ToolArtifactWorkspacePathManifest,
} from "./PluginArtifactManifestTypes.js";
export type {
  PluginKind,
  PluginPromptingManifest,
  PluginMcpServerManifest,
  PluginRootKind,
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
export type { SkillEvidenceRequirementManifest, SkillManifest } from "./PluginSkillManifestTypes.js";
export type {
  ToolApprovalManifest,
  ToolEvidenceCapabilityManifest,
  ToolExecutionManifest,
  ToolHandlerManifest,
  ToolLoadingMode,
  ToolManifest,
  ToolRuntimeCapabilitiesManifest,
  ToolRuntimeManifest,
  ToolResourceAccessIntentManifest,
  ToolResourceArgumentManifest,
  ToolResourceIntentCaseManifest,
  ToolResourceIntentManifest,
  ToolObservationContinuationManifest,
  ToolObservationManifest,
} from "./PluginToolManifestTypes.js";

export interface PluginManifest {
  ManifestVersion: 2;
  Contracts?: {
    File: string;
  };
  Plugin: {
    Name: string;
    Title?: string;
    Version: string;
    Kind: PluginKind;
    Description?: string;
  };
  Tools?: ToolManifest[];
  McpServers?: PluginMcpServerManifest[];
  Skills?: SkillManifest[];
  Resources?: unknown[];
  Prompts?: PromptManifest[];
  Templates?: TemplateManifest[];
  RootCommands?: RootCommandManifest[];
  Sandbox?: PluginSandboxManifest;
  Security?: PluginSecurityManifest;
  Prompting?: PluginPromptingManifest;
}
