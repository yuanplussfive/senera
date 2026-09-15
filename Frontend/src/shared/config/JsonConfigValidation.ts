import type { ConfigFormFieldData, ConfigFormSectionData } from "../../api/eventTypes";
import {
  isJsonConfigObject,
  readDraftOrEffectiveValue,
  readRelativeItemPath,
  readValueAtPath,
  sameOptionValue,
  type JsonConfigObject,
} from "./JsonConfigValue";

export function validateJsonConfigDraft(sections: readonly ConfigFormSectionData[], value: JsonConfigObject): string[] {
  return sections.flatMap((section) =>
    section.fields.flatMap((field) => validateJsonConfigField(field, readDraftOrEffectiveValue(value, field))),
  );
}

function validateJsonConfigField(field: ConfigFormFieldData, value: unknown): string[] {
  const label = field.label;
  if (value === undefined) return field.required === false ? [] : [`${label} 缺少必填配置`];

  const errors: string[] = [];
  if (field.type === "boolean" && typeof value !== "boolean") errors.push(`${label} 必须是布尔值`);
  if (field.type === "string") {
    if (typeof value !== "string") errors.push(`${label} 必须是字符串`);
    else errors.push(...validateStringField(field, value, label));
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${label} 必须是数字`);
    else errors.push(...validateNumberField(field, value, label));
  }
  if (field.type === "array") {
    if (!Array.isArray(value)) errors.push(`${label} 必须是数组`);
    else value.forEach((item, index) => errors.push(...validateArrayItem(field, item, index, label)));
  }
  if ((field.type === "table" || field.type === "record") && !isJsonConfigObject(value)) {
    errors.push(`${label} 必须是对象`);
  }
  if (field.options && field.options.length > 0) {
    const values = field.type === "array" && Array.isArray(value) ? value : [value];
    const checkedValues = field.type === "record" && isJsonConfigObject(value) ? Object.values(value) : values;
    checkedValues.forEach((item, index) => {
      if (!field.options?.some((option) => sameOptionValue(item, option))) {
        const suffix = checkedValues.length > 1 ? ` 第 ${index + 1} 项` : "";
        errors.push(`${label}${suffix} 必须是允许的选项`);
      }
    });
  }
  return errors;
}

function validateNumberField(field: ConfigFormFieldData, value: number, label: string): string[] {
  const errors: string[] = [];
  if (typeof field.min === "number" && value < field.min) errors.push(`${label} 不能小于 ${field.min}`);
  if (typeof field.max === "number" && value > field.max) errors.push(`${label} 不能大于 ${field.max}`);
  return errors;
}

function validateStringField(field: ConfigFormFieldData, value: string, label: string): string[] {
  const length = value.trim().length;
  const errors: string[] = [];
  if ((field.required !== false || typeof field.minLength === "number") && length === 0) {
    errors.push(`${label} 不能为空`);
    return errors;
  }
  if (typeof field.minLength === "number" && length < field.minLength) {
    errors.push(`${label} 长度不能小于 ${field.minLength}`);
  }
  if (typeof field.maxLength === "number" && length > field.maxLength) {
    errors.push(`${label} 长度不能大于 ${field.maxLength}`);
  }
  return errors;
}

function validateArrayItem(field: ConfigFormFieldData, value: unknown, index: number, label: string): string[] {
  const itemLabel = `${label} 第 ${index + 1} 项`;
  const itemType = field.itemType ?? "string";
  if (itemType === "table") {
    if (!isJsonConfigObject(value)) return [`${itemLabel} 必须是对象`];
    const effectiveItems = Array.isArray(field.effectiveValue) ? field.effectiveValue : [];
    const effectiveItem = isJsonConfigObject(effectiveItems[index]) ? effectiveItems[index] : {};
    return (field.itemFields ?? []).flatMap((itemField) => {
      const relativePath = readRelativeItemPath(field.path, itemField.path);
      return validateJsonConfigField(
        itemField,
        readValueAtPath(value, relativePath) ??
          readValueAtPath(effectiveItem, relativePath) ??
          itemField.effectiveValue,
      );
    });
  }
  if (itemType === "boolean" && typeof value !== "boolean") return [`${itemLabel} 必须是布尔值`];
  if (itemType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [`${itemLabel} 必须是数字`];
    return validateNumberField(field, value, itemLabel);
  }
  if (itemType === "string") {
    if (typeof value !== "string") return [`${itemLabel} 必须是字符串`];
    return validateStringField(field, value, itemLabel);
  }
  return [];
}
