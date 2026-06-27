import type { LoadedPluginConfig } from "./PluginConfigTypes.js";
import type {
  AgentWorkflowExecutionManifest,
  AgentWorkflowTriggerManifest,
  DecisionActionManifest,
  PluginManifest,
  PluginRootKind,
  SkillEvidenceRequirementManifest,
  ToolArtifactPolicyManifest,
  ToolEvidenceCapabilityManifest,
  ToolSearchManifest,
} from "./PluginManifestTypes.js";

export type RegisteredToolHandler =
  | {
      kind: "PluginProcess";
    }
  | {
      kind: "HostCapability";
      capability: string;
    };


export interface LoadedPlugin {
  rootPath: string;
  rootKind: PluginRootKind;
  manifestPath: string;
  config: LoadedPluginConfig;
  manifest: PluginManifest;
}


export interface RegisteredDecisionAction {
  plugin: LoadedPlugin;
  name: string;
  kind: DecisionActionManifest["Kind"];
  xmlRoot: string;
  schemaPath: string;
  descriptionFile?: string;
  signatureFile?: string;
  signatureType?: string;
}

export interface RegisteredTool {
  plugin: LoadedPlugin;
  name: string;
  descriptionFile?: string;
  signatureFile?: string;
  signatureType?: string;
  permissions: string[];
  handler: RegisteredToolHandler;
  search?: ToolSearchManifest;
  evidenceCapabilities: ToolEvidenceCapabilityManifest[];
  artifactPolicy?: ToolArtifactPolicyManifest;
}

export interface RegisteredSkill {
  plugin: LoadedPlugin;
  name: string;
  title?: string;
  descriptionFile: string;
  workflowFile?: string;
  recommendedTools: string[];
  recommendedAgents: string[];
  recommendedWorkflows: string[];
  evidenceRequirements: SkillEvidenceRequirementManifest[];
  search?: ToolSearchManifest;
}

export interface RegisteredAgent {
  plugin: LoadedPlugin;
  name: string;
  title?: string;
  descriptionFile: string;
  instructionsFile: string;
  recommendedTools: string[];
  contextPack: string;
  outputSchemaPath: string;
  runtimeProfile: string;
  search?: ToolSearchManifest;
}

export interface RegisteredAgentContextPack {
  plugin: LoadedPlugin;
  name: string;
  description?: string;
  templateFile: string;
  inputs: string[];
  toolScope: string;
  history: string;
  artifacts: string;
  evidence?: string;
}

export interface RegisteredAgentMergePolicy {
  plugin: LoadedPlugin;
  name: string;
  description?: string;
  strategy: string;
  templateFile: string;
  outputSchemaPath?: string;
}

export interface RegisteredAgentWorkflow {
  plugin: LoadedPlugin;
  name: string;
  title?: string;
  description?: string;
  trigger: AgentWorkflowTriggerManifest;
  execution: AgentWorkflowExecutionManifest;
  jobs: RegisteredAgentWorkflowJob[];
  mergePolicy: string;
  search?: ToolSearchManifest;
}

export interface RegisteredAgentWorkflowJob {
  agent: string;
  taskFile: string;
  contextPack?: string;
  required?: boolean;
}

export interface RegisteredTemplate {
  plugin: LoadedPlugin;
  name: string;
  path: string;
}

