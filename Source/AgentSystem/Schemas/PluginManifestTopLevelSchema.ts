import { z } from "zod";
import {
  DecisionActionSchema,
  PluginEntrySchema,
  PluginKindSchema,
  PromptingSchema,
  SecuritySchema,
  TemplateSchema,
} from "./PluginManifestSharedSchema.js";
import { ToolSchema } from "./PluginToolManifestSchema.js";
import { SkillSchema } from "./PluginSkillManifestSchema.js";
import {
  AgentContextPackSchema,
  AgentMergePolicySchema,
  AgentSchema,
  AgentWorkflowSchema,
} from "./PluginAgentManifestSchema.js";
import { RootCommandSchema } from "./PluginRootCommandManifestSchema.js";

export const PluginManifestSchema = z
  .object({
    Plugin: z
      .object({
        Name: z.string().min(1),
        Title: z.string().optional(),
        Version: z.string().min(1),
        Kind: PluginKindSchema,
        Description: z.string().optional(),
        Entry: PluginEntrySchema.optional(),
      })
      .strict(),
    Compatibility: z.record(z.string(), z.unknown()).optional(),
    DecisionActions: z.array(DecisionActionSchema).optional(),
    Tools: z.array(ToolSchema).optional(),
    Skills: z.array(SkillSchema).optional(),
    Agents: z.array(AgentSchema).optional(),
    ContextPacks: z.array(AgentContextPackSchema).optional(),
    Workflows: z.array(AgentWorkflowSchema).optional(),
    MergePolicies: z.array(AgentMergePolicySchema).optional(),
    Resources: z.array(z.unknown()).optional(),
    Prompts: z.array(z.unknown()).optional(),
    Templates: z.array(TemplateSchema).optional(),
    RootCommands: z.array(RootCommandSchema).optional(),
    Security: SecuritySchema.optional(),
    Prompting: PromptingSchema.optional(),
    XmlProtocol: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

