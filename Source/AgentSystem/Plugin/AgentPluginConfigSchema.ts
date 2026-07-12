import { parse as parseToml, type TomlTableWithoutBigInt } from "smol-toml";
import { z } from "zod";
import type { LoadedPluginConfigDiagnostic } from "../Types/PluginConfigTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export const AgentPluginConfigDefaults = {
  FrameworkSection: "senera",
} as const;

const ToolRuntimeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .passthrough();

export const FrameworkRuntimeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tools: z.record(z.string(), ToolRuntimeConfigSchema).optional(),
  })
  .passthrough();

export const PluginConfigDocumentSchema = z
  .object({
    [AgentPluginConfigDefaults.FrameworkSection]: FrameworkRuntimeConfigSchema.optional(),
  })
  .passthrough();

const ConfigFieldTypeSchema = z.enum(["boolean", "string", "number", "array", "table"]);

const ConfigFieldOptionValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const ConfigFieldLevelSchema = z.enum(["basic", "advanced", "internal"]);

const ConfigSchemaFieldSchema = z
  .object({
    path: z.array(z.string().min(1)).min(1),
    label: z.string().min(1),
    description: z.string().min(1).optional(),
    placeholder: z.string().min(1).optional(),
    type: ConfigFieldTypeSchema,
    itemType: ConfigFieldTypeSchema.optional(),
    options: z.array(ConfigFieldOptionValueSchema).optional(),
    optionLabels: z.record(z.string(), z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    secret: z.boolean().optional(),
    multiline: z.boolean().optional(),
    required: z.boolean().optional(),
    level: ConfigFieldLevelSchema.optional(),
  })
  .strict();

const ConfigSchemaSectionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1).optional(),
    level: ConfigFieldLevelSchema.optional(),
    fields: z.array(ConfigSchemaFieldSchema).optional(),
  })
  .strict();

const ConfigSchemaAllowedPathSchema = z
  .object({
    path: z.array(z.string().min(1)).min(1),
    recursive: z.boolean().optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();

const PluginConfigFormSchema = z
  .object({
    version: z.literal(1),
    strict: z.boolean().optional(),
    sections: z.array(ConfigSchemaSectionSchema).optional(),
    allowedPaths: z.array(ConfigSchemaAllowedPathSchema).optional(),
  })
  .strict();

const PluginConfigSchemaDocumentSchema = z
  .object({
    form: PluginConfigFormSchema,
  })
  .strict();

export type PluginConfigSchemaDocument = z.infer<typeof PluginConfigSchemaDocumentSchema>;
export type PluginConfigSchemaField = z.infer<typeof ConfigSchemaFieldSchema>;
export type PluginConfigSchemaAllowedPath = z.infer<typeof ConfigSchemaAllowedPathSchema>;

export interface ParseLoadedPluginConfigTomlOptions {
  schemaToml?: string;
  schemaPath?: string;
  requireSchema?: boolean;
}

export function parsePluginConfigSchema(options: ParseLoadedPluginConfigTomlOptions): {
  schema?: PluginConfigSchemaDocument;
  diagnostics: LoadedPluginConfigDiagnostic[];
} {
  if (!options.schemaToml) {
    return {
      diagnostics: options.requireSchema
        ? [
            {
              severity: "warning",
              message: options.schemaPath
                ? agentErrorMessage("plugin.configSchemaMissingAtPath", { schemaPath: options.schemaPath })
                : agentErrorMessage("plugin.configSchemaMissing"),
            },
          ]
        : [],
    };
  }

  let parsed: TomlTableWithoutBigInt;
  try {
    parsed = parseToml(options.schemaToml) as TomlTableWithoutBigInt;
  } catch (error) {
    return {
      diagnostics: [
        {
          severity: "error",
          message: agentErrorMessage("plugin.configSchemaTomlInvalid", {
            message: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
    };
  }

  const result = PluginConfigSchemaDocumentSchema.safeParse(parsed);
  if (!result.success) {
    return {
      diagnostics: [
        {
          severity: "error",
          message: agentErrorMessage("plugin.configSchemaInvalid", {
            issues: result.error.issues.map(formatZodIssue).join("; "),
          }),
        },
      ],
    };
  }

  return {
    schema: result.data,
    diagnostics: [],
  };
}

export function formatZodIssue(issue: z.core.$ZodIssue): string {
  const pathText = issue.path.length > 0 ? issue.path.join(".") : "root";
  return `${pathText}: ${issue.message}`;
}
