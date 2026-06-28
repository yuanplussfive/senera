import { z } from "zod";
import {
  ToolSearchCapabilitySchema,
  ToolSearchSchema,
} from "./PluginSearchManifestSchema.js";

export const AgentSchema = z
  .object({
    Name: z.string().min(1),
    Title: z.string().min(1).optional(),
    DescriptionFile: z.string().min(1),
    InstructionsFile: z.string().min(1),
    RecommendedTools: z.array(z.string().min(1)).optional(),
    ContextPack: z.string().min(1),
    OutputSchema: z.string().min(1),
    RuntimeProfile: z.string().min(1),
    Search: ToolSearchSchema.optional(),
  })
  .strict();

export const AgentContextPackSchema = z
  .object({
    Name: z.string().min(1),
    Description: z.string().min(1).optional(),
    TemplateFile: z.string().min(1),
    Inputs: z.array(z.string().min(1)).min(1),
    ToolScope: z.string().min(1),
    History: z.string().min(1),
    Artifacts: z.string().min(1),
    Evidence: z.string().min(1).optional(),
  })
  .strict();

export const AgentMergePolicySchema = z
  .object({
    Name: z.string().min(1),
    Description: z.string().min(1).optional(),
    Strategy: z.string().min(1),
    TemplateFile: z.string().min(1),
    OutputSchema: z.string().min(1).optional(),
  })
  .strict();

const AgentWorkflowTriggerSchema = z
  .object({
    Skills: z.array(z.string().min(1)).optional(),
    Agents: z.array(z.string().min(1)).optional(),
    Capabilities: z.array(ToolSearchCapabilitySchema).optional(),
  })
  .strict();

const AgentWorkflowJobSchema = z
  .object({
    Agent: z.string().min(1),
    TaskFile: z.string().min(1),
    ContextPack: z.string().min(1).optional(),
    Required: z.boolean().optional(),
  })
  .strict();

const AgentWorkflowExecutionSchema = z
  .object({
    Strategy: z.enum(["sequential", "parallel"]),
    MaxConcurrency: z.number().int().min(1).optional(),
  })
  .strict();

export const AgentWorkflowSchema = z
  .object({
    Name: z.string().min(1),
    Title: z.string().min(1).optional(),
    Description: z.string().min(1).optional(),
    Trigger: AgentWorkflowTriggerSchema,
    Execution: AgentWorkflowExecutionSchema,
    Jobs: z.array(AgentWorkflowJobSchema).min(1),
    MergePolicy: z.string().min(1),
    Search: ToolSearchSchema.optional(),
  })
  .strict();

