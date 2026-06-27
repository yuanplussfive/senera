import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  AgentModelProviderEndpointConfig,
  AgentSystemConfig,
} from "../Types/AgentConfigTypes.js";
import {
  AgentDefaults,
  resolveAgentDefaults,
  resolveActionPlannerConfig,
  resolveAgentLoopConfig,
  resolveArtifactsConfig,
  resolveConfigStoreConfig,
  resolveFrontendConfig,
  resolveMemoryLearningConfig,
  resolvePersistenceConfig,
  resolvePresetsConfig,
  resolveServerConfig,
  resolveToolExecutionConfig,
  resolveToolLearningConfig,
  resolveToolSearchConfig,
  resolveUploadsConfig,
  resolveVectorModelsConfig,
} from "../AgentDefaults.js";
import type {
  AgentConfigFormField,
  AgentConfigFormSnapshot,
} from "../Types/ConfigFormTypes.js";

const FormSchemaPath = path.join(__dirname, "AgentSystemConfig.form.json");

const ConfigFormFieldTypeSchema = z.enum([
  "boolean",
  "string",
  "number",
  "array",
  "table",
  "record",
]);

const ConfigFormFieldOptionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

const ConfigFormFieldLevelSchema = z.enum([
  "basic",
  "advanced",
  "internal",
]);

type ConfigFormFieldSchemaInput = {
  path: string[];
  label: string;
  description?: string;
  placeholder?: string;
  type: z.infer<typeof ConfigFormFieldTypeSchema>;
  itemType?: z.infer<typeof ConfigFormFieldTypeSchema>;
  options?: Array<z.infer<typeof ConfigFormFieldOptionValueSchema>>;
  optionLabels?: Record<string, string>;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  step?: number;
  secret?: boolean;
  multiline?: boolean;
  required?: boolean;
  level?: z.infer<typeof ConfigFormFieldLevelSchema>;
  addLabel?: string;
  itemLabelPath?: string[];
  itemFields?: ConfigFormFieldSchemaInput[];
  defaultValue?: unknown;
  defaultItem?: Record<string, unknown>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
};

const ConfigFormFieldSchema: z.ZodType<ConfigFormFieldSchemaInput> = z.lazy(() =>
  z
    .object({
      path: z.array(z.string().min(1)).min(1),
      label: z.string().min(1),
      description: z.string().min(1).optional(),
      placeholder: z.string().min(1).optional(),
      type: ConfigFormFieldTypeSchema,
      itemType: ConfigFormFieldTypeSchema.optional(),
      options: z.array(ConfigFormFieldOptionValueSchema).optional(),
      optionLabels: z.record(z.string(), z.string()).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(1).optional(),
      step: z.number().optional(),
      secret: z.boolean().optional(),
      multiline: z.boolean().optional(),
      required: z.boolean().optional(),
      level: ConfigFormFieldLevelSchema.optional(),
      addLabel: z.string().min(1).optional(),
      itemLabelPath: z.array(z.string().min(1)).optional(),
      itemFields: z.array(ConfigFormFieldSchema).optional(),
      defaultValue: z.unknown().optional(),
      defaultItem: z.record(z.string(), z.unknown()).optional(),
      keyPlaceholder: z.string().min(1).optional(),
      valuePlaceholder: z.string().min(1).optional(),
    })
    .strict()
);

const ConfigFormSectionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1).optional(),
    icon: z.string().min(1).optional(),
    level: ConfigFormFieldLevelSchema.optional(),
    fields: z.array(ConfigFormFieldSchema).optional(),
  })
  .strict();

const ConfigFormDocumentSchema = z
  .object({
    form: z
      .object({
        version: z.literal(1),
        sections: z.array(ConfigFormSectionSchema).optional(),
      })
      .strict(),
  })
  .strict();

type ConfigFormFieldDefinition = z.infer<typeof ConfigFormFieldSchema>;
type ConfigFormDocument = z.infer<typeof ConfigFormDocumentSchema>;

let cachedDocument: ConfigFormDocument | undefined;

export function projectAgentConfigForm(config: AgentSystemConfig): AgentConfigFormSnapshot {
  const document = readConfigFormDocument();
  const source = config as unknown as Record<string, unknown>;
  const effectiveSource = projectEffectiveConfig(config) as unknown as Record<string, unknown>;

  return {
    version: document.form.version,
    sections: (document.form.sections ?? [])
      .filter((section) => section.level !== "internal")
      .map((section) => {
        const fields = (section.fields ?? [])
          .filter((field) => field.level !== "internal")
          .map((field) => projectConfigFormField({
            field,
            section: section.id,
            source,
            effectiveSource,
            basePath: [],
          }));
        return {
          name: section.id,
          label: section.label,
          description: section.description,
          icon: section.icon,
          keyCount: fields.length,
          fields,
        };
      }),
  };
}

function readConfigFormDocument(): ConfigFormDocument {
  if (cachedDocument) {
    return cachedDocument;
  }

  const result = ConfigFormDocumentSchema.safeParse(
    JSON.parse(fs.readFileSync(FormSchemaPath, "utf8")),
  );
  if (!result.success) {
    throw new Error(`主配置表单说明文件无效：${result.error.issues.map(formatZodIssue).join("; ")}`);
  }

  cachedDocument = result.data;
  return cachedDocument;
}

function projectConfigFormField(options: {
  field: ConfigFormFieldDefinition;
  section: string;
  source: Record<string, unknown>;
  effectiveSource: Record<string, unknown>;
  basePath: readonly string[];
}): AgentConfigFormField {
  const fullPath = [...options.basePath, ...options.field.path];
  const key = options.field.path[options.field.path.length - 1] ?? "";
  const value = readValueAtPath(options.source, fullPath);
  const effectiveValue = readValueAtPath(options.effectiveSource, fullPath);
  const itemFields = options.field.itemFields?.map((itemField) =>
    projectConfigFormField({
      field: itemField,
      section: options.section,
      source: {},
      effectiveSource: {},
      basePath: fullPath,
    })
  );

  return {
    label: options.field.label,
    section: options.section,
    key,
    path: fullPath,
    type: options.field.type,
    itemType: options.field.itemType,
    value,
    effectiveValue: effectiveValue === undefined ? value : effectiveValue,
    configured: value !== undefined,
    description: options.field.description,
    placeholder: options.field.placeholder,
    options: options.field.options,
    optionLabels: options.field.optionLabels,
    min: options.field.min,
    max: options.field.max,
    minLength: options.field.minLength,
    maxLength: options.field.maxLength,
    step: options.field.step,
    secret: options.field.secret,
    multiline: options.field.multiline,
    required: options.field.required ?? true,
    addLabel: options.field.addLabel,
    itemLabelPath: options.field.itemLabelPath,
    itemFields,
    defaultValue: options.field.defaultValue,
    defaultItem: options.field.defaultItem,
    keyPlaceholder: options.field.keyPlaceholder,
    valuePlaceholder: options.field.valuePlaceholder,
  };
}

function projectEffectiveConfig(config: AgentSystemConfig): AgentSystemConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...config,
    AgentLoop: resolveAgentLoopConfig(config),
    ToolExecution: projectResolvedToolExecution(config),
    ToolSearch: resolveToolSearchConfig(config),
    VectorModels: projectResolvedVectorModels(config),
    ToolLearning: projectResolvedToolLearning(config),
    MemoryLearning: resolveMemoryLearningConfig(config),
    Presets: resolvePresetsConfig(config),
    Artifacts: resolveArtifactsConfig(config),
    Uploads: resolveUploadsConfig(config),
    ActionPlanner: projectResolvedActionPlanner(config),
    Frontend: resolveFrontendConfig(config),
    Server: resolveServerConfig(config),
    Persistence: resolvePersistenceConfig(config),
    ConfigStore: resolveConfigStoreConfig(config),
    Defaults: {
      ...config.Defaults,
      AgentLoop: resolveAgentLoopConfig(config),
      ToolExecution: projectResolvedToolExecution(config),
      ToolSearch: resolveToolSearchConfig(config),
      VectorModels: projectResolvedVectorModels(config),
      ToolLearning: projectResolvedToolLearning(config),
      MemoryLearning: resolveMemoryLearningConfig(config),
      Presets: resolvePresetsConfig(config),
      Artifacts: resolveArtifactsConfig(config),
      Uploads: resolveUploadsConfig(config),
      ActionPlanner: projectResolvedActionPlanner(config),
      Frontend: resolveFrontendConfig(config),
      Server: resolveServerConfig(config),
      Persistence: resolvePersistenceConfig(config),
      ConfigStore: resolveConfigStoreConfig(config),
    },
    ModelProviderEndpoints: projectModelProviderEndpoints(config),
    ModelProviders: config.ModelProviders.map((provider) => ({
      ...AgentDefaults.ModelRuntime,
      ...provider,
    })),
    ModelGroups: config.ModelGroups,
  };
}

function projectModelProviderEndpoints(config: AgentSystemConfig) {
  const endpointsById = new Map<string, AgentModelProviderEndpointConfig>();
  for (const endpoint of AgentDefaults.ModelProviderEndpoints) {
    endpointsById.set(endpoint.Id, endpoint);
  }
  for (const endpoint of config.ModelProviderEndpoints ?? []) {
    endpointsById.set(endpoint.Id, {
      ...defaultModelProviderEndpointFields(endpoint.Id),
      ...endpoint,
    });
  }
  return [...endpointsById.values()];
}

function defaultModelProviderEndpointFields(id: string) {
  return AgentDefaults.ModelProviderEndpoints.find((endpoint) => endpoint.Id === id) ?? {
    Id: id,
    Icon: "",
    Enabled: true,
    Kind: "OpenAICompatible" as const,
    BaseUrl: "",
    ApiKey: "",
    ApiVersion: "2023-06-01",
    Headers: {},
  };
}

function projectResolvedActionPlanner(config: AgentSystemConfig): NonNullable<AgentSystemConfig["ActionPlanner"]> {
  const resolved = resolveActionPlannerConfig(config);
  return {
    Enabled: resolved.Enabled,
    MaxRepairAttempts: resolved.MaxRepairAttempts,
    Evidence: resolved.Evidence,
    Client: projectResolvedPlannerClient(resolved.Client),
    TurnUnderstandingClient: projectResolvedPlannerClient(resolved.TurnUnderstandingClient),
    TaskFrameClient: projectResolvedPlannerClient(resolved.TaskFrameClient),
    EvidenceClient: projectResolvedPlannerClient(resolved.EvidenceClient),
  };
}

function projectResolvedPlannerClient(
  client: ReturnType<typeof resolveActionPlannerConfig>["Client"],
) {
  return {
    ModelProviderId: client.ModelProviderId,
    Provider: client.Provider,
    Temperature: client.Temperature,
    MaxTokens: client.MaxTokens,
  };
}

function projectResolvedToolLearning(config: AgentSystemConfig): NonNullable<AgentSystemConfig["ToolLearning"]> {
  const resolved = resolveToolLearningConfig(config);
  return {
    Enabled: resolved.Enabled,
    MaxRepairAttempts: resolved.MaxRepairAttempts,
    Patterns: resolved.Patterns,
    Client: projectResolvedPlannerClient(resolved.Client),
  };
}

function projectResolvedToolExecution(config: AgentSystemConfig): NonNullable<AgentSystemConfig["ToolExecution"]> {
  const resolved = resolveToolExecutionConfig(config);
  const defaults = resolveAgentDefaults(config);
  return {
    Mode: resolved.Mode,
    TimeoutSeconds: config.ToolExecution?.TimeoutSeconds
      ?? config.Defaults?.ToolExecution?.TimeoutSeconds
      ?? AgentDefaults.ToolExecution.TimeoutSeconds,
    MaxStdoutBytes: resolved.MaxStdoutBytes,
    MaxStderrBytes: resolved.MaxStderrBytes,
  };
}

function projectResolvedVectorModels(config: AgentSystemConfig): NonNullable<AgentSystemConfig["VectorModels"]> {
  const resolved = resolveVectorModelsConfig(config);
  const defaults = resolveAgentDefaults(config);
  return {
    Embedding: {
      Enabled: resolved.Embedding.Enabled,
      ProviderId: config.VectorModels?.Embedding?.ProviderId
        ?? config.Defaults?.VectorModels?.Embedding?.ProviderId
        ?? AgentDefaults.VectorModels.Embedding.ProviderId,
      Model: resolved.Embedding.Model,
      TimeoutSeconds: config.VectorModels?.Embedding?.TimeoutSeconds
        ?? defaults.VectorModels.Embedding.TimeoutSeconds,
      MaxNetworkRetries: resolved.Embedding.MaxNetworkRetries,
      Dimensions: resolved.Embedding.Dimensions,
      BatchSize: resolved.Embedding.BatchSize,
      InputMaxChars: resolved.Embedding.InputMaxChars,
    },
    Rerank: {
      Enabled: resolved.Rerank.Enabled,
      ProviderId: config.VectorModels?.Rerank?.ProviderId
        ?? config.Defaults?.VectorModels?.Rerank?.ProviderId
        ?? AgentDefaults.VectorModels.Rerank.ProviderId,
      Model: resolved.Rerank.Model,
      TimeoutSeconds: config.VectorModels?.Rerank?.TimeoutSeconds
        ?? defaults.VectorModels.Rerank.TimeoutSeconds,
      MaxNetworkRetries: resolved.Rerank.MaxNetworkRetries,
      EndpointPath: resolved.Rerank.EndpointPath,
      CandidateLimit: resolved.Rerank.CandidateLimit,
      TopK: resolved.Rerank.TopK,
    },
  };
}

function readValueAtPath(source: Record<string, unknown>, pathParts: readonly string[]): unknown {
  let current: unknown = source;
  for (const part of pathParts) {
    current = isRecord(current) ? current[part] : undefined;
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatZodIssue(issue: z.core.$ZodIssue): string {
  const pathText = issue.path.length > 0 ? issue.path.join(".") : "root";
  return `${pathText}: ${issue.message}`;
}
