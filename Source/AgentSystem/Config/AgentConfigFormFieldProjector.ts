import type { AgentConfigFormField } from "../Types/ConfigFormTypes.js";
import type { ConfigFormFieldDefinition } from "./AgentConfigFormDocument.js";
import { readAgentConfigFieldContract } from "./AgentConfigFieldContractCatalog.js";

export function projectConfigFormField(options: {
  field: ConfigFormFieldDefinition;
  section: string;
  source: Record<string, unknown>;
  inheritedSource: Record<string, unknown>;
  effectiveSource: Record<string, unknown>;
  basePath: readonly string[];
}): AgentConfigFormField {
  const fullPath = [...options.basePath, ...options.field.path];
  const key = options.field.path[options.field.path.length - 1] ?? "";
  const value = readValueAtPath(options.source, fullPath);
  const inheritedValue = readValueAtPath(options.inheritedSource, fullPath);
  const effectiveValue = readValueAtPath(options.effectiveSource, fullPath);
  const resolvedEffectiveValue = effectiveValue === undefined ? value : effectiveValue;
  const valueSource = readValueSource(value, inheritedValue, resolvedEffectiveValue);
  const itemFields = options.field.itemFields?.map((itemField) =>
    projectConfigFormField({
      field: itemField,
      section: options.section,
      source: {},
      inheritedSource: {},
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
    effectiveValue: resolvedEffectiveValue,
    configured: value !== undefined,
    missing: valueSource === "missing",
    valueSource,
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
    required: readAgentConfigFieldContract(fullPath, options.field.type).required,
    addLabel: options.field.addLabel,
    itemLabelPath: options.field.itemLabelPath,
    itemFields,
    defaultValue: options.field.defaultValue,
    defaultItem: options.field.defaultItem,
    keyPlaceholder: options.field.keyPlaceholder,
    valuePlaceholder: options.field.valuePlaceholder,
  };
}

function readValueSource(
  value: unknown,
  inheritedValue: unknown,
  effectiveValue: unknown,
): AgentConfigFormField["valueSource"] {
  if (value !== undefined) return "explicit";
  if (inheritedValue !== undefined) return "inherited";
  return effectiveValue === undefined ? "missing" : "default";
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
