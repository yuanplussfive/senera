import {
  parse as parseToml,
  stringify as stringifyToml,
  type TomlTableWithoutBigInt,
} from "smol-toml";
import type {
  PluginConfigField,
  PluginConfigFieldOptionValue,
  PluginConfigSection,
} from "../../api/eventTypes";

export type EditableTomlTable = Record<string, unknown>;

export function parseDraftToml(toml: string): {
  value?: TomlTableWithoutBigInt;
  error?: string;
} {
  try {
    return {
      value: parseToml(toml) as TomlTableWithoutBigInt,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeDraftFieldValue(
  toml: string,
  field: PluginConfigField,
  value: unknown,
): string {
  const document = parseToml(toml || "") as EditableTomlTable;
  setValueAtPath(document, field.path, coerceFieldValue(field, value));
  return ensureFinalNewline(stringifyToml(document as TomlTableWithoutBigInt));
}

export function readDraftValue(
  parsedDraft: TomlTableWithoutBigInt | undefined,
  field: PluginConfigField,
): unknown {
  let current: unknown = parsedDraft;
  for (const part of field.path) {
    current = isRecord(current) ? current[part] : undefined;
  }
  return current === undefined ? field.value : current;
}

export function validatePluginConfigDraft(
  sections: readonly PluginConfigSection[],
  parsedDraft: TomlTableWithoutBigInt,
): string[] {
  return sections.flatMap((section) =>
    section.fields.flatMap((field) =>
      validatePluginConfigField(field, readDraftValue(parsedDraft, field))
    )
  );
}

export function readNumberDraftCommitValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || isIncompleteNumberDraft(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readNumberDraftBlurValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "+") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function defaultArrayItem(itemType: string): unknown {
  const defaults = {
    number: 0,
    boolean: false,
    string: "",
  } satisfies Record<string, unknown>;
  return defaults[itemType as keyof typeof defaults] ?? "";
}

export function optionLabel(
  field: PluginConfigField,
  option: PluginConfigFieldOptionValue,
): string {
  return field.optionLabels?.[String(option)] ?? String(option);
}

export function sameOptionValue(
  left: unknown,
  right: PluginConfigFieldOptionValue,
): boolean {
  return String(left) === String(right);
}

export function settingLabel(field: PluginConfigField): string {
  return field.label;
}

export function ensureFinalNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function setValueAtPath(
  document: EditableTomlTable,
  path: readonly string[],
  value: unknown,
): void {
  const [lastKey] = path.slice(-1);
  if (!lastKey) return;

  let current: EditableTomlTable = document;
  for (const part of path.slice(0, -1)) {
    const next = current[part];
    if (!isRecord(next)) {
      current[part] = {};
    }
    current = current[part] as EditableTomlTable;
  }
  current[lastKey] = value;
}

function validatePluginConfigField(field: PluginConfigField, value: unknown): string[] {
  const label = settingLabel(field);
  const validators = [
    validateRequiredField,
    validatePrimitiveField,
    validateOptionField,
  ];
  return validators.flatMap((validator) => validator(field, value, label));
}

type FieldValidator = (
  field: PluginConfigField,
  value: unknown,
  label: string,
) => string[];

const validateRequiredField: FieldValidator = (field, value, label) => {
  if (value !== undefined) return [];
  return field.required === false ? [] : [`${label} 缺少必填配置`];
};

const validatePrimitiveField: FieldValidator = (field, value, label) => {
  if (value === undefined) return [];
  const validators = {
    boolean: () => typeof value === "boolean" ? [] : [`${label} 必须是布尔值`],
    string: () => typeof value === "string" ? [] : [`${label} 必须是字符串`],
    number: () => validateNumberFieldValue(field, value, label),
    array: () => validateArrayFieldValue(field, value, label),
    table: () => isRecord(value) ? [] : [`${label} 必须是表格对象`],
  } satisfies Record<PluginConfigField["type"], () => string[]>;
  return validators[field.type]();
};

const validateOptionField: FieldValidator = (field, value, label) => {
  if (!field.options || field.options.length === 0) return [];
  const values = field.type === "array" && Array.isArray(value) ? value : [value];
  return values.flatMap((item, index) => {
    if (field.options?.some((option) => sameOptionValue(item, option))) return [];
    const suffix = values.length > 1 ? ` 第 ${index + 1} 项` : "";
    return [`${label}${suffix} 必须是允许的选项`];
  });
};

function validateNumberFieldValue(
  field: PluginConfigField,
  value: unknown,
  label: string,
): string[] {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return [`${label} 必须是数字`];
  }
  return validateNumberField(field, value, label);
}

function validateArrayFieldValue(
  field: PluginConfigField,
  value: unknown,
  label: string,
): string[] {
  if (!Array.isArray(value)) return [`${label} 必须是数组`];
  return value.flatMap((item, index) => validateArrayItem(field, item, index, label));
}

function validateNumberField(
  field: PluginConfigField,
  value: number,
  label: string,
): string[] {
  return [
    typeof field.min === "number" && value < field.min ? `${label} 不能小于 ${field.min}` : null,
    typeof field.max === "number" && value > field.max ? `${label} 不能大于 ${field.max}` : null,
  ].filter((message): message is string => Boolean(message));
}

function validateArrayItem(
  field: PluginConfigField,
  value: unknown,
  index: number,
  label: string,
): string[] {
  const itemLabel = `${label} 第 ${index + 1} 项`;
  const itemType = field.itemType ?? "string";
  const validators = {
    boolean: () => typeof value === "boolean" ? [] : [`${itemLabel} 必须是布尔值`],
    number: () => validateNumberFieldValue(field, value, itemLabel),
    string: () => typeof value === "string" ? [] : [`${itemLabel} 必须是字符串`],
    table: () => isRecord(value) ? [] : [`${itemLabel} 必须是表格对象`],
  } satisfies Record<"boolean" | "number" | "string" | "table", () => string[]>;
  return itemType in validators
    ? validators[itemType as keyof typeof validators]()
    : validators.string();
}

function coerceFieldValue(field: PluginConfigField, value: unknown): unknown {
  const coercers = {
    boolean: () => Boolean(value),
    number: () => typeof value === "number" && Number.isFinite(value) ? value : 0,
    array: () => Array.isArray(value)
      ? value.map((item) => coerceArrayItem(item, field.itemType ?? "string"))
      : [],
    string: () => String(value ?? ""),
    table: () => value,
  } satisfies Record<PluginConfigField["type"], () => unknown>;
  return coercers[field.type]();
}

export function coerceArrayItem(value: unknown, itemType: string): unknown {
  const coercers = {
    number: () => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    boolean: () => Boolean(value),
    string: () => String(value ?? ""),
  } satisfies Record<"number" | "boolean" | "string", () => unknown>;
  return itemType in coercers
    ? coercers[itemType as keyof typeof coercers]()
    : coercers.string();
}

function isIncompleteNumberDraft(value: string): boolean {
  return value === "-"
    || value === "+"
    || value.endsWith(".")
    || /[eE][+-]?$/.test(value);
}

function isRecord(value: unknown): value is EditableTomlTable {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
