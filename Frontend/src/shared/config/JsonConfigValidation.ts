import type { ConfigFormFieldData, ConfigFormSectionData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import {
  isJsonConfigObject,
  isJsonConfigFieldVisible,
  readDraftOrEffectiveValue,
  readRelativeItemPath,
  readValueAtPath,
  sameOptionValue,
  type JsonConfigObject,
} from "./JsonConfigValue";

export function validateJsonConfigDraft(sections: readonly ConfigFormSectionData[], value: JsonConfigObject): string[] {
  const allFields = sections.flatMap((section) => section.fields);
  return sections.flatMap((section) =>
    section.fields.flatMap((field) =>
      isJsonConfigFieldVisible(field, value, allFields)
        ? validateJsonConfigField(field, readDraftOrEffectiveValue(value, field), value)
        : [],
    ),
  );
}

function validateJsonConfigField(
  field: ConfigFormFieldData,
  value: unknown,
  scope: JsonConfigObject,
  basePath: readonly string[] = [],
): string[] {
  if (field.optionalParents?.some((parent) => readValueAtPath(scope, parent.slice(basePath.length)) === undefined))
    return [];
  const label = field.label;
  if (value === undefined)
    return field.required === false ? [] : [frontendMessage("config.validation.missingRequired", { label })];

  const errors: string[] = [];
  if (field.type === "boolean" && typeof value !== "boolean")
    errors.push(frontendMessage("config.validation.booleanExpected", { label }));
  if (field.type === "string") {
    if (typeof value !== "string") errors.push(frontendMessage("config.validation.stringExpected", { label }));
    else errors.push(...validateStringField(field, value, label));
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value))
      errors.push(frontendMessage("config.validation.numberExpected", { label }));
    else errors.push(...validateNumberField(field, value, label));
  }
  if (field.type === "array") {
    if (!Array.isArray(value)) errors.push(frontendMessage("config.validation.arrayExpected", { label }));
    else value.forEach((item, index) => errors.push(...validateArrayItem(field, item, index, label)));
  }
  if ((field.type === "table" || field.type === "record") && !isJsonConfigObject(value)) {
    errors.push(frontendMessage("config.validation.objectExpected", { label }));
  }
  if (field.options && field.options.length > 0) {
    const values = field.type === "array" && Array.isArray(value) ? value : [value];
    const checkedValues = field.type === "record" && isJsonConfigObject(value) ? Object.values(value) : values;
    checkedValues.forEach((item, index) => {
      if (!field.options?.some((option) => sameOptionValue(item, option))) {
        const suffix =
          checkedValues.length > 1 ? frontendMessage("config.validation.optionItemSuffix", { index: index + 1 }) : "";
        errors.push(frontendMessage("config.validation.optionExpected", { label, suffix }));
      }
    });
  }
  return errors;
}

function validateNumberField(field: ConfigFormFieldData, value: number, label: string): string[] {
  const errors: string[] = [];
  if (typeof field.min === "number" && (field.minExclusive ? value <= field.min : value < field.min)) {
    errors.push(
      frontendMessage(field.minExclusive ? "config.validation.exclusiveMin" : "config.validation.min", {
        label,
        min: field.min,
      }),
    );
  }
  if (typeof field.max === "number" && (field.maxExclusive ? value >= field.max : value > field.max)) {
    errors.push(
      frontendMessage(field.maxExclusive ? "config.validation.exclusiveMax" : "config.validation.max", {
        label,
        max: field.max,
      }),
    );
  }
  return errors;
}

function validateStringField(field: ConfigFormFieldData, value: string, label: string): string[] {
  const length = value.trim().length;
  const errors: string[] = [];
  if ((field.required !== false || typeof field.minLength === "number") && length === 0) {
    errors.push(frontendMessage("config.validation.emptyRequired", { label }));
    return errors;
  }
  if (typeof field.minLength === "number" && length < field.minLength) {
    errors.push(frontendMessage("config.validation.minLength", { label, minLength: field.minLength }));
  }
  if (typeof field.maxLength === "number" && length > field.maxLength) {
    errors.push(frontendMessage("config.validation.maxLength", { label, maxLength: field.maxLength }));
  }
  return errors;
}

function validateArrayItem(field: ConfigFormFieldData, value: unknown, index: number, label: string): string[] {
  const itemLabel = frontendMessage("config.validation.itemLabel", { label, index: index + 1 });
  const itemType = field.itemType ?? "string";
  if (itemType === "table") {
    if (!isJsonConfigObject(value)) return [frontendMessage("config.validation.objectExpected", { label: itemLabel })];
    const effectiveItems = Array.isArray(field.effectiveValue) ? field.effectiveValue : [];
    const effectiveItem = isJsonConfigObject(effectiveItems[index]) ? effectiveItems[index] : {};
    return (field.itemFields ?? []).flatMap((itemField) => {
      const relativePath = readRelativeItemPath(field.path, itemField.path);
      return validateJsonConfigField(
        itemField,
        readValueAtPath(value, relativePath) ??
          readValueAtPath(effectiveItem, relativePath) ??
          itemField.effectiveValue,
        value,
        field.path,
      );
    });
  }
  if (itemType === "boolean" && typeof value !== "boolean")
    return [frontendMessage("config.validation.booleanExpected", { label: itemLabel })];
  if (itemType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value))
      return [frontendMessage("config.validation.numberExpected", { label: itemLabel })];
    return validateNumberField(field, value, itemLabel);
  }
  if (itemType === "string") {
    if (typeof value !== "string") return [frontendMessage("config.validation.stringExpected", { label: itemLabel })];
    return validateStringField(field, value, itemLabel);
  }
  return [];
}
