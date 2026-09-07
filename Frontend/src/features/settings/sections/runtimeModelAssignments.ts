import type { ConfigFormFieldData, ConfigFormSectionData } from "../../../api/eventTypes";
import type { JsonConfigObject } from "../../../shared/config/JsonConfigForm";
import { writeJsonConfigFieldValue } from "../../../shared/config/JsonConfigForm";
import { providerEnabled, readModelCapabilities, readString } from "../../chat/modelConfigData";
import { isUnknownRecord as isRecord } from "../../../lib/unknownValue";
import type { ModelProviderDraft, ProviderEndpointDraft } from "../../chat/modelConfigTypes";

export interface RuntimeModelAssignmentField extends ConfigFormFieldData {
  modelSelection: NonNullable<ConfigFormFieldData["modelSelection"]>;
}

export interface RuntimeModelAssignmentCandidate {
  model: ModelProviderDraft;
  provider: ProviderEndpointDraft;
}

export interface RuntimeModelAssignmentSelection {
  value: string;
  unavailableLabel?: string;
  inherited?: boolean;
}

export interface RuntimeModelPoolAssignmentSelection {
  inheritanceEnabled: boolean;
  modelIds: string[];
}

export interface RuntimeModelAssignmentNamespaceOptions {
  namespace: string;
  pathPrefix: readonly string[];
  labelPrefix?: string;
}

export function readRuntimeModelAssignmentFields(
  sections: readonly ConfigFormSectionData[],
): RuntimeModelAssignmentField[] {
  return sections.flatMap((section) =>
    section.fields.filter((field): field is RuntimeModelAssignmentField => Boolean(field.modelSelection)),
  );
}

export function projectSectionConfigFields(
  section: ConfigFormSectionData,
  allSections: readonly ConfigFormSectionData[],
): ConfigFormSectionData {
  const hiddenPaths = new Set<string>();
  for (const field of readRuntimeModelAssignmentFields(allSections)) {
    hiddenPaths.add(pathKey(field.path));
    if (field.modelSelection.providerPath) {
      hiddenPaths.add(pathKey(field.modelSelection.providerPath));
    }
    if (field.modelSelection.inheritance?.path) {
      hiddenPaths.add(pathKey(field.modelSelection.inheritance.path));
    }
  }
  const fields = section.fields.filter((field) => !hiddenPaths.has(pathKey(field.path)));
  return { ...section, fields, keyCount: fields.length };
}

export function namespaceRuntimeModelAssignmentSections(
  sections: readonly ConfigFormSectionData[],
  options: RuntimeModelAssignmentNamespaceOptions,
): ConfigFormSectionData[] {
  return sections.map((section) => {
    const name = `${options.namespace}:${section.name}`;
    const fields = section.fields.map((field) => namespaceField(field, name, options.pathPrefix));
    return {
      ...section,
      name,
      label: options.labelPrefix ? `${options.labelPrefix} · ${section.label}` : section.label,
      fields,
      keyCount: fields.length,
    };
  });
}

export function readRuntimeModelAssignmentCandidates({
  field,
  models,
  providers,
  modelTemplate,
}: {
  field: RuntimeModelAssignmentField;
  models: readonly ModelProviderDraft[];
  providers: readonly ProviderEndpointDraft[];
  modelTemplate: Record<string, unknown>;
}): RuntimeModelAssignmentCandidate[] {
  const providersById = new Map(providers.map((provider) => [provider.Id, provider]));
  return models
    .flatMap((model) => {
      const provider = providersById.get(model.ProviderId);
      if (!provider || !providerEnabled(provider)) return [];
      const capabilities = readModelCapabilities(model, modelTemplate);
      return capabilities[field.modelSelection.capability] === true ? [{ model, provider }] : [];
    })
    .sort((left, right) => {
      const modelOrder = left.model.Model.localeCompare(right.model.Model);
      return modelOrder !== 0 ? modelOrder : left.provider.Id.localeCompare(right.provider.Id);
    });
}

export function readRuntimeModelAssignmentSelection({
  field,
  allFields,
  candidates,
  defaultModelId,
  draft,
}: {
  field: RuntimeModelAssignmentField;
  allFields: readonly ConfigFormFieldData[];
  candidates: readonly RuntimeModelAssignmentCandidate[];
  defaultModelId: string;
  draft: JsonConfigObject;
}): RuntimeModelAssignmentSelection {
  assertSingleModelAssignment(field);
  if (field.modelSelection.valueKind === "model-id") {
    const configuredModelId = readString(readPathValue(draft, field.path));
    if (field.modelSelection.inheritance?.source === "default-model" && !configuredModelId) {
      return { value: inheritedValue(field), inherited: true };
    }
    const modelId = configuredModelId ?? readString(readFieldValue(field, draft)) ?? defaultModelId;
    if (!modelId || candidates.some((candidate) => candidate.model.Id === modelId)) {
      return { value: modelId };
    }
    return { value: missingValue(field, modelId), unavailableLabel: modelId };
  }

  const providerPath = field.modelSelection.providerPath;
  const providerField = providerPath
    ? allFields.find((candidate) => pathKey(candidate.path) === pathKey(providerPath))
    : undefined;
  const providerId = providerPath
    ? (readString(readPathValue(draft, providerPath)) ?? readString(providerField?.effectiveValue))
    : undefined;
  const modelName = readString(readFieldValue(field, draft));
  if (!providerId || !modelName) return { value: "" };
  const selected = candidates.find(
    (candidate) => candidate.provider.Id === providerId && candidate.model.Model === modelName,
  );
  if (selected) return { value: selected.model.Id };
  const label = `${modelName} · ${providerId}`;
  return { value: missingValue(field, label), unavailableLabel: label };
}

export function readRuntimeModelPoolAssignmentSelection({
  field,
  allFields,
  draft,
}: {
  field: RuntimeModelAssignmentField;
  allFields: readonly ConfigFormFieldData[];
  draft: JsonConfigObject;
}): RuntimeModelPoolAssignmentSelection {
  assertModelPoolAssignment(field);
  const inheritancePath = field.modelSelection.inheritance?.path;
  const inheritanceField = inheritancePath
    ? allFields.find((candidate) => pathKey(candidate.path) === pathKey(inheritancePath))
    : undefined;
  const inheritanceValue = inheritancePath
    ? (readPathValue(draft, inheritancePath) ?? inheritanceField?.effectiveValue)
    : false;
  return {
    inheritanceEnabled: inheritanceValue === true,
    modelIds: readModelIds(readFieldValue(field, draft)),
  };
}

export function writeRuntimeModelAssignment(
  draft: JsonConfigObject,
  field: RuntimeModelAssignmentField,
  candidate: RuntimeModelAssignmentCandidate,
): JsonConfigObject {
  assertSingleModelAssignment(field);
  if (field.modelSelection.valueKind === "model-id") {
    return writeJsonConfigFieldValue(draft, field.path, candidate.model.Id);
  }
  const withModel = writeJsonConfigFieldValue(draft, field.path, candidate.model.Model);
  return field.modelSelection.providerPath
    ? writeJsonConfigFieldValue(withModel, field.modelSelection.providerPath, candidate.provider.Id)
    : withModel;
}

export function writeRuntimeModelAssignmentInheritance(
  draft: JsonConfigObject,
  field: RuntimeModelAssignmentField,
): JsonConfigObject {
  assertSingleModelAssignment(field);
  if (field.modelSelection.inheritance?.source !== "default-model") {
    throw new TypeError(`Model assignment ${field.modelSelection.id} cannot inherit the default model.`);
  }
  return writeJsonConfigFieldValue(draft, field.path, undefined);
}

export function isRuntimeModelAssignmentInheritanceValue(field: RuntimeModelAssignmentField, value: string): boolean {
  return value === inheritedValue(field);
}

export function writeRuntimeModelPoolAssignment(
  draft: JsonConfigObject,
  field: RuntimeModelAssignmentField,
  selection: RuntimeModelPoolAssignmentSelection,
): JsonConfigObject {
  assertModelPoolAssignment(field);
  let next = writeJsonConfigFieldValue(draft, field.path, [...selection.modelIds]);
  if (field.modelSelection.inheritance?.path) {
    next = writeJsonConfigFieldValue(next, field.modelSelection.inheritance.path, selection.inheritanceEnabled);
  }
  return next;
}

export function isRuntimeModelPoolAssignment(field: RuntimeModelAssignmentField): boolean {
  return field.modelSelection.cardinality === "many";
}

function readFieldValue(field: ConfigFormFieldData, draft: JsonConfigObject): unknown {
  return readPathValue(draft, field.path) ?? field.effectiveValue;
}

function readPathValue(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function missingValue(field: RuntimeModelAssignmentField, value: string): string {
  return `missing:${field.modelSelection.id}:${value}`;
}

function inheritedValue(field: RuntimeModelAssignmentField): string {
  return `inherit:${field.modelSelection.id}`;
}

function namespaceField(
  field: ConfigFormFieldData,
  section: string,
  pathPrefix: readonly string[],
): ConfigFormFieldData {
  const modelSelection = field.modelSelection
    ? {
        ...field.modelSelection,
        ...(field.modelSelection.providerPath
          ? { providerPath: [...pathPrefix, ...field.modelSelection.providerPath] }
          : {}),
        ...(field.modelSelection.inheritance?.path
          ? {
              inheritance: {
                ...field.modelSelection.inheritance,
                path: [...pathPrefix, ...field.modelSelection.inheritance.path],
              },
            }
          : {}),
      }
    : undefined;
  return {
    ...field,
    section,
    path: [...pathPrefix, ...field.path],
    ...(modelSelection ? { modelSelection } : {}),
    ...(field.itemFields
      ? { itemFields: field.itemFields.map((item) => namespaceField(item, section, pathPrefix)) }
      : {}),
  };
}

function readModelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const modelId = item.trim();
    return modelId ? [modelId] : [];
  });
}

function assertSingleModelAssignment(field: RuntimeModelAssignmentField): void {
  if (isRuntimeModelPoolAssignment(field)) {
    throw new TypeError(`Model assignment ${field.modelSelection.id} requires the model-pool API.`);
  }
}

function assertModelPoolAssignment(field: RuntimeModelAssignmentField): void {
  if (
    !isRuntimeModelPoolAssignment(field) ||
    field.modelSelection.valueKind !== "model-id" ||
    field.modelSelection.mutation !== "config"
  ) {
    throw new TypeError(`Model assignment ${field.modelSelection.id} is not an editable model pool.`);
  }
}

function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}
