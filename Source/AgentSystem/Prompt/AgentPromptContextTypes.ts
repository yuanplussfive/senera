import type { AgentActionDecision } from "../ActionPlanner/AgentActionPlannerTypes.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentRoleplayPresetContext } from "../Presets/AgentPresetTypes.js";
import type { AgentPromptContractView } from "./AgentPromptContractTypes.js";
import type { AgentExecutionEnvironmentContext } from "./AgentExecutionEnvironmentContext.js";
import type { AgentContinuityMemoryPromptContext } from "../Continuity/AgentContinuityMemoryTypes.js";
import type { AgentWorkflowPromptContext } from "./AgentWorkflowPromptContext.js";
import type { AgentSceneContext } from "./AgentSceneContextCompiler.js";
import type {
  AgentPromptContextLayerManifestEntry,
  AgentPromptContextRevisions,
} from "./AgentPromptContextLayerTypes.js";

export interface AgentPromptToolContext {
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string;
  argumentsContract?: AgentPromptContractView;
  documentationMarkdown: string;
}

export interface AgentPromptContext {
  ExecutionEnvironment: AgentExecutionEnvironmentContext;
  ToolCards: AgentPromptToolContext[];
  ToolDiscoveryToolName: string | null;
  RootCommand: AgentRootCommand | null;
  RoleplayPreset: AgentRoleplayPresetContext;
  ContinuityMemory: AgentContinuityMemoryPromptContext;
  Workflow: AgentWorkflowPromptContext;
  Scene: AgentSceneContext;
  ContextLayers: readonly AgentPromptContextLayerManifestEntry[];
  ContextRevisions: AgentPromptContextRevisions;
}

export interface AgentPromptContextOptions {
  loadedToolNames?: string[];
  toolSections?: AgentPromptSectionOptions;
  summarySection?: string;
  triggerSection?: string;
  avoidSection?: string;
  rootCommand?: AgentRootCommand;
  roleplayPreset?: AgentRoleplayPresetContext;
  continuityMemory?: AgentContinuityMemoryPromptContext;
  workflow?: AgentWorkflowPromptContext;
  scene?: AgentSceneContext;
}

export interface AgentPromptSectionOptions {
  summary?: string;
  trigger?: string;
  avoid?: string;
}

export interface AgentPromptRootCommandOptions {
  decision: AgentActionDecision;
  loadedToolNames: readonly string[];
  allowedToolNames?: readonly string[];
}
