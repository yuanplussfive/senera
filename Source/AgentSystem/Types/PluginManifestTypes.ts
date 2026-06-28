import type {
  AgentContextPackManifest,
  AgentManifest,
  AgentMergePolicyManifest,
  AgentWorkflowManifest,
} from "./PluginAgentManifestTypes.js";
import type {
  DecisionActionManifest,
  PluginEntryManifest,
  PluginKind,
  PluginPromptingManifest,
  PluginSecurityManifest,
  PromptManifest,
  TemplateManifest,
} from "./PluginManifestSharedTypes.js";
import type { RootCommandManifest } from "./PluginRootCommandManifestTypes.js";
import type { SkillManifest } from "./PluginSkillManifestTypes.js";
import type { ToolManifest } from "./PluginToolManifestTypes.js";

export type {
  AgentContextPackManifest,
  AgentManifest,
  AgentMergePolicyManifest,
  AgentWorkflowExecutionManifest,
  AgentWorkflowJobManifest,
  AgentWorkflowManifest,
  AgentWorkflowTriggerManifest,
} from "./PluginAgentManifestTypes.js";
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
  DecisionActionManifest,
  PluginEntryManifest,
  PluginKind,
  PluginPromptingManifest,
  PluginRootKind,
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
  ToolEvidenceCapabilityManifest,
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
  DecisionActions?: DecisionActionManifest[];
  Tools?: ToolManifest[];
  Skills?: SkillManifest[];
  Agents?: AgentManifest[];
  ContextPacks?: AgentContextPackManifest[];
  Workflows?: AgentWorkflowManifest[];
  MergePolicies?: AgentMergePolicyManifest[];
  Resources?: unknown[];
  Prompts?: PromptManifest[];
  Templates?: TemplateManifest[];
  RootCommands?: RootCommandManifest[];
  Security?: PluginSecurityManifest;
  Prompting?: PluginPromptingManifest;
}
