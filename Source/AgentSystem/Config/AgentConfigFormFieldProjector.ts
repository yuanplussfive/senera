import type { AgentConfigFormField } from "../Types/ConfigFormTypes.js";
import type { ConfigFormFieldDefinition } from "./AgentConfigFormDocument.js";

export function projectConfigFormField(options: {
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
    }),
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
