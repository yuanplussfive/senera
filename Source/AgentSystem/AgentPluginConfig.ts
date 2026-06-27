import fs from "node:fs";
import path from "node:path";
import {
  parse as parseToml,
  stringify as stringifyToml,
  type TomlTableWithoutBigInt,
} from "smol-toml";
import { z } from "zod";
import { resolvePluginDiscoveryConfig } from "./AgentDefaults.js";
import type { AgentSystemConfig } from "./Types/AgentConfigTypes.js";
import type {
  AgentPluginConfigSnapshotItem,
  LoadedPluginConfig,
  LoadedPluginConfigDiagnostic,
  LoadedPluginConfigField,
  LoadedPluginConfigFieldType,
  LoadedPluginConfigSection,
  LoadedPluginRuntimeConfig,
} from "./Types/PluginConfigTypes.js";
import type {
  LoadedPlugin,
} from "./Types/PluginRuntimeTypes.js";

export const AgentPluginConfigDefaults = {
  FrameworkSection: "senera",
} as const;

const ToolRuntimeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .passthrough();

const FrameworkRuntimeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tools: z.record(z.string(), ToolRuntimeConfigSchema).optional(),
  })
  .passthrough();

const PluginConfigDocumentSchema = z
  .object({
    [AgentPluginConfigDefaults.FrameworkSection]: FrameworkRuntimeConfigSchema.optional(),
  })
  .passthrough();

const ConfigFieldTypeSchema = z.enum([
  "boolean",
  "string",
  "number",
  "array",
  "table",
]);

const ConfigFieldOptionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

const ConfigFieldLevelSchema = z.enum([
  "basic",
  "advanced",
  "internal",
]);

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

type PluginConfigSchemaDocument = z.infer<typeof PluginConfigSchemaDocumentSchema>;
type PluginConfigSchemaField = z.infer<typeof ConfigSchemaFieldSchema>;
type PluginConfigSchemaAllowedPath = z.infer<typeof ConfigSchemaAllowedPathSchema>;

interface ParseLoadedPluginConfigTomlOptions {
  schemaToml?: string;
  schemaPath?: string;
  requireSchema?: boolean;
}

type EditableTomlTable = Record<string, unknown>;

export function resolvePluginConfigFileName(config: AgentSystemConfig): string {
  return resolvePluginDiscoveryConfig(config).ConfigFileName;
}

export function readLoadedPluginConfig(
  pluginRootPath: string,
  config: AgentSystemConfig,
): LoadedPluginConfig {
  const fileName = resolvePluginConfigFileName(config);
  const configPath = path.join(pluginRootPath, fileName);
  const templatePath = resolvePluginConfigTemplatePath(pluginRootPath, fileName);
  const schemaPath = resolvePluginConfigSchemaPath(pluginRootPath, fileName);
  const exists = fs.existsSync(configPath);
  const templateExists = fs.existsSync(templatePath);
  const schemaExists = fs.existsSync(schemaPath);
  const source = exists ? "file" : templateExists ? "example" : "default";
  const toml = exists
    ? fs.readFileSync(configPath, "utf8")
    : templateExists
      ? fs.readFileSync(templatePath, "utf8")
      : defaultPluginConfigToml();
  const parsed = parseLoadedPluginConfigToml(toml, {
    schemaPath,
    schemaToml: schemaExists ? fs.readFileSync(schemaPath, "utf8") : undefined,
    requireSchema: source !== "default",
  });

  return {
    fileName,
    path: configPath,
    exists,
    source,
    templatePath: templateExists ? templatePath : undefined,
    templateExists,
    needsUserConfig: source === "example",
    toml,
    ...parsed,
  };
}

export function parseLoadedPluginConfigToml(
  toml: string,
  options: ParseLoadedPluginConfigTomlOptions = {},
): Pick<
  LoadedPluginConfig,
  "runtime" | "sections" | "diagnostics"
> {
  const schemaResult = parsePluginConfigSchema(options);
  let parsed: TomlTableWithoutBigInt;

  try {
    parsed = parseToml(toml || defaultPluginConfigToml()) as TomlTableWithoutBigInt;
  } catch (error) {
    return {
      runtime: disabledRuntimeConfig(),
      sections: [],
      diagnostics: [
        ...schemaResult.diagnostics,
        {
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  const root = PluginConfigDocumentSchema.safeParse(parsed);
  if (!root.success) {
    return {
      runtime: disabledRuntimeConfig(),
      sections: [],
      diagnostics: [
        ...schemaResult.diagnostics,
        {
          severity: "error",
          message: root.error.issues.map(formatZodIssue).join("; "),
        },
      ],
    };
  }

  const sections = schemaResult.schema
    ? projectSchemaSections(parsed, schemaResult.schema)
    : [];
  const diagnostics: LoadedPluginConfigDiagnostic[] = [
    ...schemaResult.diagnostics,
    ...projectStrictPathDiagnostics(parsed, schemaResult.schema),
    ...validatePluginConfigFields(sections).map((message) => ({
      severity: "error" as const,
      message,
    })),
  ];

  return {
    runtime: projectRuntimeConfig(root.data[AgentPluginConfigDefaults.FrameworkSection]),
    sections,
    diagnostics,
  };
}

export function projectPluginConfigSnapshot(
  plugin: LoadedPlugin,
): AgentPluginConfigSnapshotItem {
  const manifest = plugin.manifest;
  const tools = (manifest.Tools ?? []).map((tool) => ({
    name: tool.Name,
    summary: tool.Search?.Summary,
    enabled: isLoadedPluginToolEnabled(plugin, tool.Name),
  }));

  return {
    name: manifest.Plugin.Name,
    title: manifest.Plugin.Title ?? manifest.Plugin.Name,
    kind: manifest.Plugin.Kind,
    rootKind: plugin.rootKind,
    description: manifest.Plugin.Description,
    rootPath: plugin.rootPath,
    manifestPath: plugin.manifestPath,
    configPath: plugin.config.path,
    configExists: plugin.config.exists,
    configSource: plugin.config.source,
    configTemplatePath: plugin.config.templatePath,
    configTemplateExists: plugin.config.templateExists,
    needsUserConfig: plugin.config.needsUserConfig,
    enabled: plugin.config.runtime.enabled,
    available: isLoadedPluginAvailable(plugin),
    toolCount: tools.length,
    enabledToolCount: tools.filter((tool) => tool.enabled).length,
    tools,
    sections: plugin.config.sections,
    toml: plugin.config.toml,
    diagnostics: plugin.config.diagnostics,
  };
}

export function isLoadedPluginAvailable(plugin: LoadedPlugin): boolean {
  if (plugin.rootKind === "System") {
    return !hasErrorDiagnostics(plugin.config.diagnostics);
  }

  return plugin.config.runtime.enabled
    && !plugin.config.needsUserConfig
    && !hasErrorDiagnostics(plugin.config.diagnostics);
}

export function isLoadedPluginToolEnabled(
  plugin: LoadedPlugin,
  toolName: string,
): boolean {
  if (plugin.rootKind === "System") {
    return true;
  }

  return plugin.config.runtime.tools[toolName]?.enabled !== false;
}

export function validatePluginConfigTomlForWrite(toml: string, configPath?: string): void {
  const schemaPath = configPath
    ? resolvePluginConfigSchemaPath(path.dirname(configPath), path.basename(configPath))
    : undefined;
  const schemaToml = schemaPath && fs.existsSync(schemaPath)
    ? fs.readFileSync(schemaPath, "utf8")
    : undefined;
  if (configPath && !schemaToml) {
    throw new Error(`插件配置 TOML 无效：缺少插件配置 schema：${schemaPath ?? configPath}`);
  }
  const parsed = parseLoadedPluginConfigToml(toml, {
    schemaPath,
    schemaToml,
    requireSchema: Boolean(configPath),
  });
  const error = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (error) {
    throw new Error(`插件配置 TOML 无效：${error.message}`);
  }
}

export function writePluginConfigToml(configPath: string, toml: string): void {
  validatePluginConfigTomlForWrite(toml, configPath);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, ensureFinalNewline(toml), "utf8");
}

export function setPluginConfigEnabled(
  pluginConfig: LoadedPluginConfig,
  target: { enabled: boolean; toolName?: string },
): string {
  const source = pluginConfig.toml || defaultPluginConfigToml();
  const document = parseToml(source) as EditableTomlTable;
  const configPath = target.toolName
    ? [AgentPluginConfigDefaults.FrameworkSection, "tools", target.toolName, "enabled"]
    : [AgentPluginConfigDefaults.FrameworkSection, "enabled"];
  setValueAtPath(document, configPath, target.enabled);

  const nextToml = ensureFinalNewline(stringifyToml(document as TomlTableWithoutBigInt));
  validatePluginConfigTomlForWrite(nextToml, pluginConfig.path);
  return nextToml;
}

export function defaultPluginConfigToml(): string {
  return [
    "[senera]",
    "enabled = true",
    "",
  ].join("\n");
}

function resolvePluginConfigTemplatePath(pluginRootPath: string, fileName: string): string {
  const extension = path.extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  return path.join(pluginRootPath, `${baseName}.example${extension}`);
}

function resolvePluginConfigSchemaPath(pluginRootPath: string, fileName: string): string {
  const extension = path.extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  return path.join(pluginRootPath, `${baseName}.schema${extension}`);
}

function parsePluginConfigSchema(
  options: ParseLoadedPluginConfigTomlOptions,
): {
  schema?: PluginConfigSchemaDocument;
  diagnostics: LoadedPluginConfigDiagnostic[];
} {
  if (!options.schemaToml) {
    return {
      diagnostics: options.requireSchema
        ? [{
          severity: "warning",
          message: options.schemaPath
            ? `缺少插件配置 schema：${options.schemaPath}`
            : "缺少插件配置 schema。",
        }]
        : [],
    };
  }

  let parsed: TomlTableWithoutBigInt;
  try {
    parsed = parseToml(options.schemaToml) as TomlTableWithoutBigInt;
  } catch (error) {
    return {
      diagnostics: [{
        severity: "error",
        message: `插件配置 schema TOML 无效：${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }

  const result = PluginConfigSchemaDocumentSchema.safeParse(parsed);
  if (!result.success) {
    return {
      diagnostics: [{
        severity: "error",
        message: `插件配置 schema 结构无效：${result.error.issues.map(formatZodIssue).join("; ")}`,
      }],
    };
  }

  return {
    schema: result.data,
    diagnostics: [],
  };
}

function projectRuntimeConfig(value: unknown): LoadedPluginRuntimeConfig {
  const framework = FrameworkRuntimeConfigSchema.parse(value ?? {});
  return {
    enabled: framework.enabled ?? true,
    tools: Object.fromEntries(
      Object.entries(framework.tools ?? {}).map(([name, tool]) => [
        name,
        {
          enabled: tool.enabled,
        },
      ]),
    ),
  };
}

function disabledRuntimeConfig(): LoadedPluginRuntimeConfig {
  return {
    enabled: false,
    tools: {},
  };
}

function hasErrorDiagnostics(diagnostics: readonly LoadedPluginConfigDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function projectSchemaSections(
  parsed: TomlTableWithoutBigInt,
  schema: PluginConfigSchemaDocument,
): LoadedPluginConfigSection[] {
  return (schema.form.sections ?? [])
    .filter((section) => section.level !== "internal")
    .map((section) => {
      const fields = (section.fields ?? [])
        .filter((field) => field.level !== "internal")
        .map((field) => projectSchemaField(parsed, section.id, field));
      return {
        name: section.id,
        label: section.label,
        description: section.description,
        keyCount: fields.length,
        toml: "",
        fields,
      };
    });
}

function projectSchemaField(
  parsed: TomlTableWithoutBigInt,
  sectionName: string,
  schemaField: PluginConfigSchemaField,
): LoadedPluginConfigField {
  const key = schemaField.path[schemaField.path.length - 1] ?? "";
  return {
    label: schemaField.label,
    section: sectionName,
    key,
    path: schemaField.path,
    type: schemaField.type,
    itemType: schemaField.itemType,
    value: readValueAtPath(parsed, schemaField.path),
    description: schemaField.description,
    placeholder: schemaField.placeholder,
    options: schemaField.options,
    optionLabels: schemaField.optionLabels,
    min: schemaField.min,
    max: schemaField.max,
    step: schemaField.step,
    secret: schemaField.secret,
    multiline: schemaField.multiline,
    required: schemaField.required ?? true,
  };
}

function projectStrictPathDiagnostics(
  parsed: TomlTableWithoutBigInt,
  schema: PluginConfigSchemaDocument | undefined,
): LoadedPluginConfigDiagnostic[] {
  if (!schema?.form.strict) {
    return [];
  }

  const allowedPaths = [
    ...(schema.form.sections ?? []).flatMap((section) =>
      (section.fields ?? []).map((field) => ({
        path: field.path,
        recursive: false,
      }))
    ),
    ...(schema.form.allowedPaths ?? []),
    {
      path: [AgentPluginConfigDefaults.FrameworkSection, "enabled"],
      recursive: false,
    },
    {
      path: [AgentPluginConfigDefaults.FrameworkSection, "tools"],
      recursive: true,
    },
  ];
  const unknownPaths = collectTomlLeafPaths(parsed)
    .filter((leafPath) => !allowedPaths.some((allowedPath) =>
      pathMatchesAllowedPath(leafPath, allowedPath)
    ));

  return unknownPaths.map((unknownPath) => ({
    severity: "error" as const,
    message: `配置项未在 schema 中声明：${unknownPath.join(".")}`,
  }));
}

function validatePluginConfigFields(
  sections: readonly LoadedPluginConfigSection[],
): string[] {
  const errors: string[] = [];

  for (const section of sections) {
    for (const field of section.fields) {
      errors.push(...validatePluginConfigField(field));
    }
  }

  return errors;
}

function validatePluginConfigField(field: LoadedPluginConfigField): string[] {
  const errors: string[] = [];
  const label = configFieldDisplayName(field);

  if (field.value === undefined) {
    return field.required === false ? [] : [`${label} 缺少必填配置`];
  }

  if (field.type === "boolean" && typeof field.value !== "boolean") {
    errors.push(`${label} 必须是布尔值`);
  }

  if (field.type === "string" && typeof field.value !== "string") {
    errors.push(`${label} 必须是字符串`);
  }

  if (field.type === "number") {
    if (typeof field.value !== "number" || !Number.isFinite(field.value)) {
      errors.push(`${label} 必须是数字`);
    } else {
      errors.push(...validateNumberConfigField(field, field.value, label));
    }
  }

  if (field.type === "array") {
    if (!Array.isArray(field.value)) {
      errors.push(`${label} 必须是数组`);
    } else {
      field.value.forEach((item, index) => {
        errors.push(...validateArrayConfigItem(field, item, index, label));
      });
    }
  }

  if (field.type === "table" && !isPlainTomlTable(field.value)) {
    errors.push(`${label} 必须是表格对象`);
  }

  if (field.options && field.options.length > 0) {
    const values = field.type === "array" && Array.isArray(field.value) ? field.value : [field.value];
    values.forEach((value, index) => {
      if (!field.options?.some((option) => sameConfigOptionValue(value, option))) {
        const suffix = values.length > 1 ? ` 第 ${index + 1} 项` : "";
        errors.push(`${label}${suffix} 必须是允许的选项`);
      }
    });
  }

  return errors;
}

function validateNumberConfigField(
  field: LoadedPluginConfigField,
  value: number,
  label: string,
): string[] {
  const errors: string[] = [];
  if (typeof field.min === "number" && value < field.min) {
    errors.push(`${label} 不能小于 ${field.min}`);
  }
  if (typeof field.max === "number" && value > field.max) {
    errors.push(`${label} 不能大于 ${field.max}`);
  }
  return errors;
}

function validateArrayConfigItem(
  field: LoadedPluginConfigField,
  item: unknown,
  index: number,
  label: string,
): string[] {
  const itemLabel = `${label} 第 ${index + 1} 项`;
  const itemType = field.itemType ?? "string";

  if (itemType === "boolean" && typeof item !== "boolean") {
    return [`${itemLabel} 必须是布尔值`];
  }
  if (itemType === "number") {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      return [`${itemLabel} 必须是数字`];
    }
    return validateNumberConfigField(field, item, itemLabel);
  }
  if (itemType === "string" && typeof item !== "string") {
    return [`${itemLabel} 必须是字符串`];
  }
  if (itemType === "table" && !isPlainTomlTable(item)) {
    return [`${itemLabel} 必须是表格对象`];
  }
  return [];
}

function configFieldDisplayName(field: LoadedPluginConfigField): string {
  return field.label;
}

function sameConfigOptionValue(
  left: unknown,
  right: string | number | boolean,
): boolean {
  return String(left) === String(right);
}

function collectTomlLeafPaths(value: unknown, prefix: readonly string[] = []): string[][] {
  if (!isPlainTomlTable(value)) {
    return prefix.length > 0 ? [Array.from(prefix)] : [];
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return prefix.length > 0 ? [Array.from(prefix)] : [];
  }

  return entries.flatMap(([key, child]) => {
    const pathParts = [...prefix, key];
    return isPlainTomlTable(child)
      ? collectTomlLeafPaths(child, pathParts)
      : [pathParts];
  });
}

function pathMatchesAllowedPath(
  pathParts: readonly string[],
  allowedPath: Pick<PluginConfigSchemaAllowedPath, "path" | "recursive">,
): boolean {
  if (allowedPath.recursive) {
    return pathStartsWith(pathParts, allowedPath.path);
  }

  return sameStringArray(pathParts, allowedPath.path);
}

function pathStartsWith(pathParts: readonly string[], prefix: readonly string[]): boolean {
  return pathParts.length >= prefix.length
    && prefix.every((part, index) => pathParts[index] === part);
}

function readValueAtPath(root: unknown, pathParts: readonly string[]): unknown {
  let current: unknown = root;
  for (const part of pathParts) {
    current = isPlainTomlTable(current) ? current[part] : undefined;
  }
  return current;
}

function setValueAtPath(
  document: EditableTomlTable,
  pathParts: readonly string[],
  value: unknown,
): void {
  const [lastKey] = pathParts.slice(-1);
  if (!lastKey) {
    return;
  }

  let current: EditableTomlTable = document;
  for (const part of pathParts.slice(0, -1)) {
    const next = current[part];
    if (!isPlainTomlTable(next)) {
      current[part] = {};
    }
    current = current[part] as EditableTomlTable;
  }
  current[lastKey] = value;
}

function isPlainTomlTable(value: unknown): value is TomlTableWithoutBigInt {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function ensureFinalNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function formatZodIssue(issue: z.core.$ZodIssue): string {
  const pathText = issue.path.length > 0 ? issue.path.join(".") : "root";
  return `${pathText}: ${issue.message}`;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
