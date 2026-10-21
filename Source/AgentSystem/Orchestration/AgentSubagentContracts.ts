import { z } from "zod";

export const AgentSubagentLaunchContractVersion = 2 as const;
export const AgentSubagentCapabilityCeilingVersion = 2 as const;

export const AgentSubagentCapabilityCeilingSchema = z
  .object({
    version: z.literal(AgentSubagentCapabilityCeilingVersion),
    allowedTools: z.array(z.string().trim().min(1)),
    allowedAgents: z.array(z.string().trim().min(1)),
    denyExtensions: z.boolean(),
    sources: z.array(z.string().trim().min(1)),
  })
  .strict();

export type AgentSubagentCapabilityCeiling = z.infer<typeof AgentSubagentCapabilityCeilingSchema>;

const AgentSubagentDiagnosticSchema = z
  .object({
    code: z.string().trim().min(1),
    severity: z.enum(["warning", "error"]),
    message: z.string().trim().min(1),
  })
  .strict();

export type AgentSubagentDiagnostic = z.infer<typeof AgentSubagentDiagnosticSchema>;

export const AgentSubagentLaunchContractSchema = z
  .object({
    version: z.literal(AgentSubagentLaunchContractVersion),
    runId: z.string().trim().min(1),
    role: z
      .object({
        id: z.string().trim().min(1),
        description: z.string().trim().min(1),
        source: z.enum(["builtin", "workspace"]),
        filePath: z.string().trim().min(1),
        revision: z.string().trim().min(1),
        canDelegate: z.boolean(),
      })
      .strict(),
    context: z.enum(["fresh", "fork"]),
    /** Persisted so restart recovery can distinguish detached work from waits. */
    executionMode: z.enum(["wait", "detach"]).optional(),
    model: z.string().trim().min(1).optional(),
    modelCandidates: z.array(z.string().trim().min(1)),
    thinking: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
    systemPromptMode: z.enum(["append", "replace"]),
    inheritProjectContext: z.boolean(),
    inheritSkills: z.boolean(),
    skills: z
      .object({
        requested: z.array(z.string().trim().min(1)),
      })
      .strict(),
    tools: z
      .object({
        effectiveToolNames: z.array(z.string().trim().min(1)),
        capabilityCeiling: AgentSubagentCapabilityCeilingSchema,
      })
      .strict(),
    diagnostics: z.array(AgentSubagentDiagnosticSchema),
    launchContractDigest: z.string().trim().min(1),
  })
  .strict();

export type AgentSubagentLaunchContract = z.infer<typeof AgentSubagentLaunchContractSchema>;

export function parseAgentSubagentLaunchContract(value: unknown): AgentSubagentLaunchContract {
  return AgentSubagentLaunchContractSchema.parse(value);
}

export function parseAgentSubagentCapabilityCeiling(value: unknown): AgentSubagentCapabilityCeiling {
  return AgentSubagentCapabilityCeilingSchema.parse(value);
}
