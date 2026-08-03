import { z } from "zod";
import { AgentExtensionNameSchema } from "../Extensions/AgentExtensionIdentity.js";
import { validateAgentMcpEnvironmentTemplate } from "./AgentMcpEnvironmentTemplate.js";

export const AgentMcpExecutionTargets = {
  Sandbox: "sandbox",
  Local: "local",
} as const;

export const AgentMcpExecutionTargetSchema = z.enum(AgentMcpExecutionTargets);

const AgentMcpExecutionSchema = z
  .object({
    targets: z.array(AgentMcpExecutionTargetSchema).min(1),
    preferred: AgentMcpExecutionTargetSchema,
  })
  .strict()
  .superRefine((execution, context) => {
    const duplicateIndex = execution.targets.findIndex((target, index) => execution.targets.indexOf(target) !== index);
    if (duplicateIndex >= 0) {
      context.addIssue({
        code: "custom",
        path: ["targets", duplicateIndex],
        message: "MCP execution targets must be unique.",
      });
    }
    if (!execution.targets.includes(execution.preferred)) {
      context.addIssue({
        code: "custom",
        path: ["preferred"],
        message: "MCP execution preferred target must be declared in targets.",
      });
    }
  });

const AgentMcpEnvironmentTemplateSchema = z.string().superRefine((value, context) => {
  const error = validateAgentMcpEnvironmentTemplate(value);
  if (error) context.addIssue({ code: "custom", message: error });
});

const AgentMcpEnvironmentRecordSchema = z.record(z.string().min(1), AgentMcpEnvironmentTemplateSchema);

const AgentMcpStdioServerConfigurationSchema = z
  .object({
    type: z.literal("stdio"),
    command: z.string().trim().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().trim().min(1).default("."),
    env: AgentMcpEnvironmentRecordSchema.optional(),
  })
  .strict();

const AgentMcpHttpServerConfigurationSchema = z
  .object({
    type: z.literal("http"),
    url: z.string().url(),
    headers: AgentMcpEnvironmentRecordSchema.optional(),
  })
  .strict();

export const AgentMcpLegacyServerConfigurationSchema = z.discriminatedUnion("type", [
  AgentMcpStdioServerConfigurationSchema,
  AgentMcpHttpServerConfigurationSchema,
]);

export const AgentMcpConfigurationDocumentSchema = z
  .object({
    execution: AgentMcpExecutionSchema.optional(),
    mcpServers: z.record(AgentExtensionNameSchema, AgentMcpLegacyServerConfigurationSchema),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (Object.keys(configuration.mcpServers).length === 0) {
      context.addIssue({
        code: "custom",
        message: "mcpServers must declare at least one server.",
        path: ["mcpServers"],
      });
    }
    if (!configuration.execution && Object.values(configuration.mcpServers).some((server) => server.type === "stdio")) {
      context.addIssue({
        code: "custom",
        message: "execution is required when the package declares a stdio MCP server.",
        path: ["execution"],
      });
    }
  });

export type AgentMcpConfigurationDocument = z.infer<typeof AgentMcpConfigurationDocumentSchema>;
export type AgentMcpLegacyServerConfiguration = z.infer<typeof AgentMcpLegacyServerConfigurationSchema>;
export type AgentMcpExecutionTarget = z.infer<typeof AgentMcpExecutionTargetSchema>;
export type AgentMcpExecution = z.infer<typeof AgentMcpExecutionSchema>;
