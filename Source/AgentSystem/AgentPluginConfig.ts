import fs from "node:fs";
import path from "node:path";
import {
  parse as parseToml,
  stringify as stringifyToml,
  type TomlTableWithoutBigInt,
} from "smol-toml";
import { z } from "zod";
import { resolvePluginDiscoveryConfig } from "./AgentDefaults.js";
import type {
  AgentPluginConfigSnapshotItem,
  AgentSystemConfig,
  LoadedPlugin,
  LoadedPluginConfig,
  LoadedPluginConfigDiagnostic,
  LoadedPluginConfigField,
  LoadedPluginConfigFieldType,
  LoadedPluginConfigSection,
  LoadedPluginRuntimeConfig,
} from "./Types.js";

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
  "unknown",
]);

const ConfigFieldOptionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

const ConfigFieldMetadataSchema = z
  .object({
    label: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    placeholder: z.string().min(1).optional(),
    type: ConfigFieldTypeSchema.optional(),
    itemType: ConfigFieldTypeSchema.optional(),
    options: z.array(ConfigFieldOptionValueSchema).optional(),
    optionLabels: z.record(z.string(), z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    secret: z.boolean().optional(),
    multiline: z.boolean().optional(),
  })
  .passthrough();

type ConfigFieldMetadata = z.infer<typeof ConfigFieldMetadataSchema>;

const ConfigSectionMetadataSchema = z
  .object({
    label: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  })
  .passthrough();

type ConfigSectionMetadata = z.infer<typeof ConfigSectionMetadataSchema>;

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
  const exists = fs.existsSync(configPath);
  const templateExists = fs.existsSync(templatePath);
  const source = exists ? "file" : templateExists ? "example" : "default";
  const toml = exists
    ? fs.readFileSync(configPath, "utf8")
    : templateExists
      ? fs.readFileSync(templatePath, "utf8")
      : defaultPluginConfigToml();
  const parsed = parseLoadedPluginConfigToml(toml);

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

export function parseLoadedPluginConfigToml(toml: string): Pick<
  LoadedPluginConfig,
  "runtime" | "sections" | "diagnostics"
> {
  let parsed: TomlTableWithoutBigInt;
  try {
    parsed = parseToml(toml || defaultPluginConfigToml()) as TomlTableWithoutBigInt;
  } catch (error) {
    return {
      runtime: disabledRuntimeConfig(),
      sections: projectTomlSections(toml, {}),
      diagnostics: [
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
      sections: projectTomlSections(toml, parsed),
      diagnostics: [
        {
          severity: "error",
          message: root.error.issues.map(formatZodIssue).join("; "),
        },
      ],
    };
  }

  return {
    runtime: projectRuntimeConfig(root.data[AgentPluginConfigDefaults.FrameworkSection]),
    sections: projectTomlSections(toml, parsed),
    diagnostics: [],
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

export function validatePluginConfigTomlForWrite(toml: string): void {
  const parsed = parseLoadedPluginConfigToml(toml);
  const error = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (error) {
    throw new Error(`插件配置 TOML 无效：${error.message}`);
  }
  const fieldErrors = validatePluginConfigFields(parsed.sections);
  if (fieldErrors.length > 0) {
    throw new Error(`插件配置字段无效：${fieldErrors.join("; ")}`);
  }
}

export function writePluginConfigToml(configPath: string, toml: string): void {
  validatePluginConfigTomlForWrite(toml);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, ensureFinalNewline(toml), "utf8");
}

export function setPluginConfigEnabled(
  pluginConfig: LoadedPluginConfig,
  target: { enabled: boolean; toolName?: string },
): string {
  const source = ensureFinalNewline(pluginConfig.toml || defaultPluginConfigToml());
  parseToml(source);

  const sectionPath = target.toolName
    ? [AgentPluginConfigDefaults.FrameworkSection, "tools", target.toolName]
    : [AgentPluginConfigDefaults.FrameworkSection];
  const nextToml = writeTomlBooleanValue(source, {
    sectionPath,
    key: "enabled",
    value: target.enabled,
  });
  validatePluginConfigTomlForWrite(nextToml);
  return nextToml;
}

export function defaultPluginConfigToml(): string {
  return [
    "[senera]",
    "# 是否启用这个插件。",
    "enabled = true",
    "",
    "[senera.fields.senera.enabled]",
    'label = "启用插件"',
    'description = "关闭后该插件不会参与外部工具集。"',
    'type = "boolean"',
    "",
    "[senera.sections.senera]",
    'label = "启用状态"',
    'description = "控制该插件是否参与外部工具集。"',
    "",
  ].join("\n");
}

function resolvePluginConfigTemplatePath(pluginRootPath: string, fileName: string): string {
  const extension = path.extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  return path.join(pluginRootPath, `${baseName}.example${extension}`);
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
  if (field.itemType === "boolean" && typeof item !== "boolean") {
    return [`${itemLabel} 必须是布尔值`];
  }
  if (field.itemType === "number") {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      return [`${itemLabel} 必须是数字`];
    }
    return validateNumberConfigField(field, item, itemLabel);
  }
  if ((field.itemType === "string" || !field.itemType) && typeof item !== "string") {
    return [`${itemLabel} 必须是字符串`];
  }
  return [];
}

function configFieldDisplayName(field: LoadedPluginConfigField): string {
  return field.label ?? field.path.join(".");
}

function sameConfigOptionValue(
  left: unknown,
  right: string | number | boolean,
): boolean {
  return String(left) === String(right);
}

function asTomlTable(value: unknown): TomlTableWithoutBigInt {
  return isPlainTomlTable(value) ? value : {};
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

function projectTomlSections(
  toml: string,
  parsed: TomlTableWithoutBigInt,
): LoadedPluginConfigSection[] {
  const lines = splitTomlLines(toml);
  const explicitSections = findTomlSections(lines)
    .filter((section) => !isConfigMetadataSection(section.path));
  if (explicitSections.length > 0) {
    return explicitSections.map((section) => {
      const fields = projectTomlFields(
        lines,
        section,
        readTomlTableAtPath(parsed, section.path),
        parsed,
      );
      const metadata = readSectionMetadata(parsed, section.path);
      return {
        name: section.path.join("."),
        label: metadata?.label,
        description: metadata?.description,
        keyCount: fields.length,
        toml: ensureFinalNewline(lines.slice(section.startLine, section.endLine).join("\n")),
        fields,
      };
    });
  }

  return Object.entries(parsed)
    .filter((entry): entry is [string, TomlTableWithoutBigInt] => isPlainTomlTable(entry[1]))
    .map(([name, value]) => {
      const sectionPath = [name];
      const metadata = readSectionMetadata(parsed, sectionPath);
      const fields = Object.entries(value)
        .filter(([key]) => !isConfigMetadataField(sectionPath, key))
        .map(([key, fieldValue]) => toTomlConfigField({
          sectionName: name,
          sectionPath,
          key,
          value: fieldValue,
          metadata: readFieldMetadata(parsed, sectionPath, key),
        }));
      return {
        name,
        label: metadata?.label,
        description: metadata?.description,
        keyCount: fields.length,
        toml: ensureFinalNewline(stringifyToml({ [name]: value })),
        fields,
      };
    });
}

function projectTomlFields(
  lines: readonly string[],
  section: TomlSectionRange,
  table: TomlTableWithoutBigInt,
  parsed: TomlTableWithoutBigInt,
): LoadedPluginConfigField[] {
  const fields: LoadedPluginConfigField[] = [];
  for (let index = section.startLine + 1; index < section.endLine; index += 1) {
    const key = readTomlAssignmentKey(lines[index]);
    if (!key) {
      continue;
    }

    fields.push(toTomlConfigField({
      sectionName: section.path.join("."),
      sectionPath: section.path,
      key,
      value: table[key],
      metadata: readFieldMetadata(parsed, section.path, key),
    }));
  }
  return fields;
}

function toTomlConfigField(input: {
  sectionName: string;
  sectionPath: string[];
  key: string;
  value: unknown;
  metadata?: ConfigFieldMetadata;
}): LoadedPluginConfigField {
  const metadata = input.metadata;
  const type = metadata?.type ?? inferTomlFieldType(input.value);
  return {
    label: metadata?.label,
    section: input.sectionName,
    key: input.key,
    path: [...input.sectionPath, input.key],
    type,
    itemType: metadata?.itemType ?? (type === "array" && Array.isArray(input.value)
      ? inferArrayItemType(input.value)
      : undefined),
    value: input.value,
    description: metadata?.description,
    placeholder: metadata?.placeholder,
    options: metadata?.options,
    optionLabels: metadata?.optionLabels,
    min: metadata?.min,
    max: metadata?.max,
    step: metadata?.step,
    secret: metadata?.secret,
    multiline: metadata?.multiline,
  };
}

function readFieldMetadata(
  parsed: TomlTableWithoutBigInt,
  sectionPath: readonly string[],
  key: string,
): ConfigFieldMetadata | undefined {
  let current: unknown = asTomlTable(
    asTomlTable(parsed[AgentPluginConfigDefaults.FrameworkSection]).fields,
  );

  for (const part of [...sectionPath, key]) {
    current = isPlainTomlTable(current) ? current[part] : undefined;
  }

  const result = ConfigFieldMetadataSchema.safeParse(current);
  return result.success ? result.data : undefined;
}

function readSectionMetadata(
  parsed: TomlTableWithoutBigInt,
  sectionPath: readonly string[],
): ConfigSectionMetadata | undefined {
  let current: unknown = asTomlTable(
    asTomlTable(parsed[AgentPluginConfigDefaults.FrameworkSection]).sections,
  );

  for (const part of sectionPath) {
    current = isPlainTomlTable(current) ? current[part] : undefined;
  }

  const result = ConfigSectionMetadataSchema.safeParse(current);
  return result.success ? result.data : undefined;
}

function isConfigMetadataSection(sectionPath: readonly string[]): boolean {
  return sectionPath[0] === AgentPluginConfigDefaults.FrameworkSection
    && (sectionPath[1] === "fields" || sectionPath[1] === "sections");
}

function isConfigMetadataField(sectionPath: readonly string[], key: string): boolean {
  return sectionPath.length === 1
    && sectionPath[0] === AgentPluginConfigDefaults.FrameworkSection
    && (key === "fields" || key === "sections");
}

function readTomlTableAtPath(
  parsed: TomlTableWithoutBigInt,
  pathParts: readonly string[],
): TomlTableWithoutBigInt {
  let current: unknown = parsed;
  for (const part of pathParts) {
    current = isPlainTomlTable(current) ? current[part] : undefined;
  }
  return isPlainTomlTable(current) ? current : {};
}

function readTomlAssignmentKey(line: string): string | undefined {
  const trimmed = line.trimStart();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) {
    return undefined;
  }

  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex < 1) {
    return undefined;
  }

  const key = trimmed.slice(0, equalsIndex).trim();
  return key && !key.includes(".") ? key : undefined;
}

function inferTomlFieldType(value: unknown): LoadedPluginConfigFieldType {
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (isPlainTomlTable(value)) {
    return "table";
  }
  return "unknown";
}

function inferArrayItemType(values: readonly unknown[]): LoadedPluginConfigFieldType {
  const types = values.map(inferTomlFieldType).filter((type) => type !== "unknown");
  const [first] = types;
  return first && types.every((type) => type === first) ? first : "unknown";
}

interface TomlSectionRange {
  path: string[];
  startLine: number;
  endLine: number;
}

function writeTomlBooleanValue(
  toml: string,
  input: {
    sectionPath: string[];
    key: string;
    value: boolean;
  },
): string {
  const lines = splitTomlLines(toml);
  const sections = findTomlSections(lines);
  const section = sections.find((item) => sameStringArray(item.path, input.sectionPath));
  const nextLine = `${input.key} = ${input.value ? "true" : "false"}`;

  if (!section) {
    const needsBlank = lines.length > 0 && lines[lines.length - 1]?.trim() !== "";
    return ensureFinalNewline([
      ...lines,
      ...(needsBlank ? [""] : []),
      formatTomlSectionHeader(input.sectionPath),
      nextLine,
    ].join("\n"));
  }

  const keyLine = findTomlKeyLine(lines, section, input.key);
  if (keyLine >= 0) {
    lines[keyLine] = `${readLeadingWhitespace(lines[keyLine])}${nextLine}`;
  } else {
    lines.splice(section.startLine + 1, 0, nextLine);
  }

  return ensureFinalNewline(lines.join("\n"));
}

function splitTomlLines(toml: string): string[] {
  const normalized = toml.split("\r\n").join("\n").split("\r").join("\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return body.length > 0 ? body.split("\n") : [];
}

function findTomlSections(lines: readonly string[]): TomlSectionRange[] {
  const sections: TomlSectionRange[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const sectionPath = readTomlSectionPath(lines[index]);
    if (!sectionPath) {
      continue;
    }

    const previous = sections[sections.length - 1];
    if (previous) {
      previous.endLine = index;
    }

    sections.push({
      path: sectionPath,
      startLine: index,
      endLine: lines.length,
    });
  }

  return sections;
}

function readTomlSectionPath(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]") || trimmed.startsWith("[[")) {
    return undefined;
  }

  const body = trimmed.slice(1, -1).trim();
  const parts = body.split(".").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function findTomlKeyLine(
  lines: readonly string[],
  section: TomlSectionRange,
  key: string,
): number {
  for (let index = section.startLine + 1; index < section.endLine; index += 1) {
    if (tomlLineDefinesKey(lines[index], key)) {
      return index;
    }
  }
  return -1;
}

function tomlLineDefinesKey(line: string, key: string): boolean {
  const trimmed = line.trimStart();
  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return false;
  }

  if (!trimmed.startsWith(key)) {
    return false;
  }

  let index = key.length;
  while (trimmed[index] === " " || trimmed[index] === "\t") {
    index += 1;
  }
  return trimmed[index] === "=";
}

function formatTomlSectionHeader(path: readonly string[]): string {
  return `[${path.join(".")}]`;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readLeadingWhitespace(value: string): string {
  let index = 0;
  while (value[index] === " " || value[index] === "\t") {
    index += 1;
  }
  return value.slice(0, index);
}
