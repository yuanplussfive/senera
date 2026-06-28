import type { TomlTableWithoutBigInt } from "smol-toml";
import type {
  LoadedPluginConfigDiagnostic,
  LoadedPluginConfigField,
  LoadedPluginConfigSection,
} from "../Types/PluginConfigTypes.js";
import {
  collectTomlLeafPaths,
  isPlainTomlTable,
  pathMatchesAllowedPath,
  readTomlValueAtPath,
} from "./AgentPluginConfigDocument.js";
import {
  AgentPluginConfigDefaults,
  type PluginConfigSchemaDocument,
  type PluginConfigSchemaField,
} from "./AgentPluginConfigSchema.js";

export function projectPluginConfigSections(
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

export function projectStrictPathDiagnostics(
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

export function validatePluginConfigSections(
  sections: readonly LoadedPluginConfigSection[],
): string[] {
  return sections.flatMap((section) =>
    section.fields.flatMap((field) => validatePluginConfigField(field)));
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
    value: readTomlValueAtPath(parsed, schemaField.path),
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

function validatePluginConfigField(field: LoadedPluginConfigField): string[] {
  const errors: string[] = [];
  const label = field.label;

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
    errors.push(...validateArrayConfigField(field, label));
  }

  if (field.type === "table" && !isPlainTomlTable(field.value)) {
    errors.push(`${label} 必须是表格对象`);
  }

  errors.push(...validateOptionConfigField(field, label));
  return errors;
}

function validateArrayConfigField(
  field: LoadedPluginConfigField,
  label: string,
): string[] {
  if (!Array.isArray(field.value)) {
    return [`${label} 必须是数组`];
  }

  return field.value.flatMap((item, index) =>
    validateArrayConfigItem(field, item, index, label));
}

function validateOptionConfigField(
  field: LoadedPluginConfigField,
  label: string,
): string[] {
  if (!field.options || field.options.length === 0) {
    return [];
  }

  const values = field.type === "array" && Array.isArray(field.value) ? field.value : [field.value];
  return values.flatMap((value, index) => {
    if (field.options?.some((option) => sameConfigOptionValue(value, option))) {
      return [];
    }

    const suffix = values.length > 1 ? ` 第 ${index + 1} 项` : "";
    return [`${label}${suffix} 必须是允许的选项`];
  });
}

function validateNumberConfigField(
  field: LoadedPluginConfigField,
  value: number,
  label: string,
): string[] {
  return [
    typeof field.min === "number" && value < field.min ? `${label} 不能小于 ${field.min}` : undefined,
    typeof field.max === "number" && value > field.max ? `${label} 不能大于 ${field.max}` : undefined,
  ].filter((message): message is string => Boolean(message));
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

function sameConfigOptionValue(
  left: unknown,
  right: string | number | boolean,
): boolean {
  return String(left) === String(right);
}
