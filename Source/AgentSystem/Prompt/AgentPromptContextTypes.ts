import type { AgentActionDecision } from "../ActionPlanner/AgentActionPlannerTypes.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentPersonaContext } from "./AgentPersonaContext.js";
import type { AgentPromptContractView } from "./AgentPromptContractTypes.js";
import type { AgentExecutionEnvironmentContext } from "./AgentExecutionEnvironmentContext.js";
import type { AgentContinuityMemoryPromptContext } from "../Continuity/AgentContinuityMemoryTypes.js";
import type { AgentWorkflowPromptContext } from "./AgentWorkflowPromptContext.js";
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
  Persona: AgentPersonaContext;
  ContinuityMemory: AgentContinuityMemoryPromptContext;
  Workflow: AgentWorkflowPromptContext;
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
  persona?: AgentPersonaContext;
  continuityMemory?: AgentContinuityMemoryPromptContext;
  workflow?: AgentWorkflowPromptContext;
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
