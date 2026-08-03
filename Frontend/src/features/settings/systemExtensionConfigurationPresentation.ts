import type {
  ConfigFormFieldData,
  ConfigFormModelCapability,
  ConfigFormSectionData,
  ConfigSnapshotData,
} from "../../api/eventTypes";
import {
  resolveFrontendLocalizedText,
  type FrontendLocale,
  type FrontendLocalizedText,
} from "../../i18n/frontendLocaleModel";
import {
  findTopField,
  providerEnabled,
  readModelCapabilities,
  readModelProviders,
  readProviderEndpoints,
} from "../chat/modelConfigData";

interface ModelOption {
  readonly value: string;
  readonly label: string;
}

export function projectSystemExtensionConfigurationSections(options: {
  sections: readonly ConfigFormSectionData<FrontendLocalizedText>[];
  locale: FrontendLocale;
  configSnapshot: ConfigSnapshotData | null;
}): ConfigFormSectionData[] {
  const modelOptions = createModelOptionsReader(options.configSnapshot);
  return options.sections.map((section) => ({
    ...section,
    label: resolveFrontendLocalizedText(section.label, options.locale),
    description: section.description ? resolveFrontendLocalizedText(section.description, options.locale) : undefined,
    fields: section.fields.map((field) => projectField(field, options.locale, modelOptions)),
  }));
}

function projectField(
  field: ConfigFormFieldData<FrontendLocalizedText>,
  locale: FrontendLocale,
  readModelOptions: (capability: ConfigFormModelCapability) => readonly ModelOption[],
): ConfigFormFieldData {
  const options =
    field.modelSelection?.valueKind === "model-id" ? readModelOptions(field.modelSelection.capability) : undefined;
  const configuredModelId = typeof field.effectiveValue === "string" ? field.effectiveValue.trim() : "";
  const projectedOptions = options ? [...options] : undefined;
  if (configuredModelId && projectedOptions && !projectedOptions.some((option) => option.value === configuredModelId)) {
    projectedOptions.push({ value: configuredModelId, label: configuredModelId });
  }
  return {
    ...field,
    label: resolveFrontendLocalizedText(field.label, locale),
    description: field.description ? resolveFrontendLocalizedText(field.description, locale) : undefined,
    placeholder: field.placeholder ? resolveFrontendLocalizedText(field.placeholder, locale) : undefined,
    ...(projectedOptions
      ? {
          options: projectedOptions.map((option) => option.value),
          optionLabels: Object.fromEntries(projectedOptions.map((option) => [option.value, option.label])),
        }
      : {}),
    itemFields: field.itemFields?.map((item) => projectField(item, locale, readModelOptions)),
  };
}

function createModelOptionsReader(
  snapshot: ConfigSnapshotData | null,
): (capability: ConfigFormModelCapability) => readonly ModelOption[] {
  const section = snapshot?.form.sections.find((candidate) => candidate.name === "models");
  const modelField = findTopField(section, "ModelProviders");
  const endpointField = findTopField(section, "ModelProviderEndpoints");
  const models = readModelProviders(modelField?.effectiveValue);
  const endpoints = new Map(
    readProviderEndpoints(endpointField?.effectiveValue).map((endpoint) => [endpoint.Id, endpoint]),
  );
  const template = modelField?.defaultItem ?? {};
  const cache = new Map<ConfigFormModelCapability, readonly ModelOption[]>();

  return (capability) => {
    const cached = cache.get(capability);
    if (cached) return cached;
    const projected = models
      .filter((model) => {
        const endpoint = endpoints.get(model.ProviderId);
        return Boolean(
          model.Id && endpoint && providerEnabled(endpoint) && readModelCapabilities(model, template)[capability],
        );
      })
      .map((model) => ({ value: model.Id, label: `${model.Model || model.Id} · ${model.ProviderId}` }))
      .sort((left, right) => left.label.localeCompare(right.label));
    cache.set(capability, projected);
    return projected;
  };
}
