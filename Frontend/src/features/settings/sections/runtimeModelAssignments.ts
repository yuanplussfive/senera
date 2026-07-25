import type { ConfigFormFieldData, ConfigFormSectionData } from "../../../api/eventTypes";
import type { JsonConfigObject } from "../../../shared/config/JsonConfigForm";
import { writeJsonConfigFieldValue } from "../../../shared/config/JsonConfigForm";
import { providerEnabled, readModelCapabilities, readString } from "../../chat/modelConfigData";
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
  }
  const fields = section.fields.filter((field) => !hiddenPaths.has(pathKey(field.path)));
  return { ...section, fields, keyCount: fields.length };
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
  if (field.modelSelection.valueKind === "model-id") {
    const modelId = readString(readFieldValue(field, draft)) ?? defaultModelId;
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

export function writeRuntimeModelAssignment(
  draft: JsonConfigObject,
  field: RuntimeModelAssignmentField,
  candidate: RuntimeModelAssignmentCandidate,
): JsonConfigObject {
  if (field.modelSelection.valueKind === "model-id") {
    return writeJsonConfigFieldValue(draft, field.path, candidate.model.Id);
  }
  const withModel = writeJsonConfigFieldValue(draft, field.path, candidate.model.Model);
  return field.modelSelection.providerPath
    ? writeJsonConfigFieldValue(withModel, field.modelSelection.providerPath, candidate.provider.Id)
    : withModel;
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

function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
