import type { AgentActionDecision } from "../ActionPlanner/AgentActionPlanner.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { AgentRoleplayPresetContext } from "../Presets/AgentPresetTypes.js";
import type { AgentPromptContractView } from "./AgentPromptContractProjector.js";
import type { AgentExecutionEnvironmentContext } from "./AgentExecutionEnvironmentContext.js";

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
}

export interface AgentPromptSkillContext extends AgentPromptSkillCatalogContext {
  documentationXml: string;
  matchedTerms: string[];
  matchedFields: AgentPromptSkillMatchedFieldContext[];
  score: number;
}

export interface AgentPromptSkillMatchedFieldContext {
  term: string;
  fields: string[];
}

export interface AgentPromptContext {
  ExecutionEnvironment: AgentExecutionEnvironmentContext;
  ToolCards: AgentPromptToolContext[];
  ActiveSkills: AgentPromptSkillContext[];
  ToolDiscoveryToolName: string | null;
  RootCommand: AgentRootCommand | null;
  RoleplayPreset: AgentRoleplayPresetContext;
}

export interface AgentPromptContextOptions {
  loadedToolNames?: string[] | "all";
  toolSections?: AgentPromptSectionOptions;
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
}
