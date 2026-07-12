import type { ConfigFormFieldData, ConfigFormSectionData } from "../../api/eventTypes";
import {
  isRecord,
  readDraftOrEffectiveValue,
  readRelativeItemPath,
  readValueAtPath,
  sameOptionValue,
  type JsonConfigObject,
} from "./jsonConfigFormModel";
import { jsonConfigFormMessages } from "./jsonConfigFormMessages";

export function validateJsonConfigDraft(sections: readonly ConfigFormSectionData[], value: JsonConfigObject): string[] {
  return sections.flatMap((section) =>
    section.fields.flatMap((field) => validateJsonConfigField(field, readDraftOrEffectiveValue(value, field))),
  );
}

function validateJsonConfigField(field: ConfigFormFieldData, value: unknown): string[] {
  const label = field.label;
  if (value === undefined) {
    return field.required === false ? [] : [jsonConfigFormMessages.validation.missingRequired(label)];
  }

  const errors: string[] = [];
  if (field.type === "boolean" && typeof value !== "boolean") {
    errors.push(jsonConfigFormMessages.validation.booleanExpected(label));
  }
  if (field.type === "string") {
    errors.push(...validateStringFieldValue(field, value, label));
  }
  if (field.type === "number") {
    errors.push(...validateNumberFieldValue(field, value, label));
  }
  if (field.type === "array") {
    errors.push(...validateArrayFieldValue(field, value, label));
  }
  if ((field.type === "table" || field.type === "record") && !isRecord(value)) {
    errors.push(jsonConfigFormMessages.validation.objectExpected(label));
  }
  errors.push(...validateOptionFieldValue(field, value, label));
  return errors;
}

function validateStringFieldValue(field: ConfigFormFieldData, value: unknown, label: string): string[] {
  return typeof value === "string"
    ? validateStringField(field, value, label)
    : [jsonConfigFormMessages.validation.stringExpected(label)];
}

function validateNumberFieldValue(field: ConfigFormFieldData, value: unknown, label: string): string[] {
  return typeof value === "number" && Number.isFinite(value)
    ? validateNumberField(field, value, label)
    : [jsonConfigFormMessages.validation.numberExpected(label)];
}

function validateArrayFieldValue(field: ConfigFormFieldData, value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    return [jsonConfigFormMessages.validation.arrayExpected(label)];
  }
  return value.flatMap((item, index) => validateArrayItem(field, item, index, label));
}

function validateOptionFieldValue(field: ConfigFormFieldData, value: unknown, label: string): string[] {
  if (!field.options || field.options.length === 0) {
    return [];
  }
  const values = field.type === "array" && Array.isArray(value) ? value : [value];
  const checkedValues = field.type === "record" && isRecord(value) ? Object.values(value) : values;
  return checkedValues.flatMap((item, index) => {
    if (field.options?.some((option) => sameOptionValue(item, option))) {
      return [];
    }
    const suffix = checkedValues.length > 1 ? jsonConfigFormMessages.optionItemSuffix(index + 1) : "";
    return [jsonConfigFormMessages.validation.optionExpected(label, suffix)];
  });
}

function validateNumberField(field: ConfigFormFieldData, value: number, label: string): string[] {
  const errors: string[] = [];
  if (typeof field.min === "number" && value < field.min) {
    errors.push(jsonConfigFormMessages.validation.min(label, field.min));
  }
  if (typeof field.max === "number" && value > field.max) {
    errors.push(jsonConfigFormMessages.validation.max(label, field.max));
  }
  return errors;
}

function validateStringField(field: ConfigFormFieldData, value: string, label: string): string[] {
  const length = value.trim().length;
  const errors: string[] = [];
  if ((field.required !== false || typeof field.minLength === "number") && length === 0) {
    errors.push(jsonConfigFormMessages.validation.emptyRequired(label));
    return errors;
  }
  if (typeof field.minLength === "number" && length < field.minLength) {
    errors.push(jsonConfigFormMessages.validation.minLength(label, field.minLength));
  }
  if (typeof field.maxLength === "number" && length > field.maxLength) {
    errors.push(jsonConfigFormMessages.validation.maxLength(label, field.maxLength));
  }
  return errors;
}

function validateArrayItem(field: ConfigFormFieldData, value: unknown, index: number, label: string): string[] {
  const itemLabel = jsonConfigFormMessages.itemLabel(label, index + 1);
  const itemType = field.itemType ?? "string";
  if (itemType === "table") {
    return validateTableArrayItem(field, value, index, itemLabel);
  }
  if (itemType === "boolean" && typeof value !== "boolean") {
    return [jsonConfigFormMessages.validation.booleanExpected(itemLabel)];
  }
  if (itemType === "number") {
    return validateNumberFieldValue(field, value, itemLabel);
  }
  if (itemType === "string") {
    return validateStringFieldValue(field, value, itemLabel);
  }
  return [];
}

function validateTableArrayItem(
  field: ConfigFormFieldData,
  value: unknown,
  index: number,
  itemLabel: string,
): string[] {
  if (!isRecord(value)) {
    return [jsonConfigFormMessages.validation.objectExpected(itemLabel)];
  }
  const effectiveItems = Array.isArray(field.effectiveValue) ? field.effectiveValue : [];
  const effectiveItem = isRecord(effectiveItems[index]) ? effectiveItems[index] : {};
  return (field.itemFields ?? []).flatMap((itemField) => {
    const relativePath = readRelativeItemPath(field.path, itemField.path);
    return validateJsonConfigField(
      itemField,
      readValueAtPath(value, relativePath) ?? readValueAtPath(effectiveItem, relativePath) ?? itemField.effectiveValue,
    );
  });
}
