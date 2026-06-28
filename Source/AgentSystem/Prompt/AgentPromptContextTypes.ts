import type { AgentActionDecision } from "../ActionPlanner/AgentActionPlanner.js";
import type { AgentRootCommand, AgentRootCommandWorkflowRecommendation } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../AgentSkillActivation.js";
import type { TaskFrame } from "../BamlClient/baml_client/types.js";
import type { AgentRoleplayPresetContext } from "../Presets/AgentPresetTypes.js";
import type { AgentPromptContractView } from "./AgentPromptContractProjector.js";

export interface AgentPromptToolContext {
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string;
  argumentsContract?: AgentPromptContractView;
  documentationXml: string;
}

export interface AgentPromptSkillCatalogContext {
  name: string;
  title: string;
  summary: string;
  useCases: string[];
  avoid: string[];
  recommendedTools: string[];
  recommendedAgents: string[];
  recommendedWorkflows: string[];
}

export interface AgentPromptSkillContext extends AgentPromptSkillCatalogContext {
  documentationXml: string;
  workflowXml: string;
  matchedTerms: string[];
  matchedFields: AgentPromptSkillMatchedFieldContext[];
  score: number;
}

export interface AgentPromptSkillMatchedFieldContext {
  term: string;
  fields: string[];
}

export interface AgentPromptDecisionActionContext {
  name: string;
  kind: string;
  xmlRoot: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string;
  outputContract?: AgentPromptContractView;
  documentationXml: string;
}

export interface AgentPromptContext {
  ToolCallProtocol: AgentPromptToolCallProtocolContext;
  DecisionActions: AgentPromptDecisionActionContext[];
  ToolCards: AgentPromptToolContext[];
  ActiveSkills: AgentPromptSkillContext[];
  ToolDiscoveryToolName: string | null;
  RootCommand: AgentRootCommand | null;
  RoleplayPreset: AgentRoleplayPresetContext;
}

export interface AgentPromptToolCallProtocolContext {
  root: string;
  callTag: string;
  nameTag: string;
  argumentsTag: string;
  arrayItemTag: string;
}

export interface AgentPromptContextOptions {
  loadedToolNames?: string[] | "all";
  toolSections?: AgentPromptSectionOptions;
  actionSections?: AgentPromptSectionOptions;
  summarySection?: string;
  triggerSection?: string;
  avoidSection?: string;
  rootCommand?: AgentRootCommand;
  roleplayPreset?: AgentRoleplayPresetContext;
  skillQuery?: string;
  activeSkills?: readonly AgentActivatedSkill[];
}

export interface AgentPromptSectionOptions {
  summary?: string;
  trigger?: string;
  avoid?: string;
}

export interface AgentPromptRootCommandOptions {
  decision: AgentActionDecision;
  loadedToolNames: "all" | readonly string[];
  taskContract?: TaskFrame;
  workflowRecommendedTools?: readonly string[];
  workflowRecommendations?: readonly AgentRootCommandWorkflowRecommendation[];
}
