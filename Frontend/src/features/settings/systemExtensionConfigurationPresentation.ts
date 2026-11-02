import type {
  ConfigFormFieldData,
  ConfigFormModelCapability,
  ConfigFormSectionData,
  ConfigSnapshotData,
  SystemExtensionSettingsItem,
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
import { namespaceRuntimeModelAssignmentSections } from "./sections/runtimeModelAssignments";
import { modelSelectOption, type ModelSelectOption } from "../../shared/models/ModelSelect";

export interface SystemExtensionRuntimeModelAssignmentSection {
  readonly extensionId: string;
  readonly extensionLabel: string;
  readonly extensionIcon: SystemExtensionSettingsItem["presentation"]["icon"];
  readonly section: ConfigFormSectionData;
}

type ModelOption = ModelSelectOption;

export function readConfiguredModelConnectionOptions(
  snapshot: ConfigSnapshotData | null,
  capability: ConfigFormModelCapability,
): ModelSelectOption[] {
  return [...createModelOptionsReader(snapshot)(capability)];
}

/** Names are suggestions only: selecting one never changes the field's endpoint or credentials. */
export function readConfiguredModelNameOptions(
  snapshot: ConfigSnapshotData | null,
  capability?: ConfigFormModelCapability,
): ModelSelectOption[] {
  const section = snapshot?.form.sections.find((candidate) => candidate.name === "models");
  const endpoints = new Map(
    readProviderEndpoints(findTopField(section, "ModelProviderEndpoints")?.effectiveValue).map((endpoint) => [
      endpoint.Id,
      endpoint,
    ]),
  );
  const names = new Map<string, string[]>();
  const icons = new Map<string, string | undefined>();
  const template = findTopField(section, "ModelProviders")?.defaultItem ?? {};
  for (const model of readModelProviders(findTopField(section, "ModelProviders")?.effectiveValue)) {
    const endpoint = endpoints.get(model.ProviderId);
    if (!model.Model || !endpoint || !providerEnabled(endpoint)) continue;
    if (capability && !readModelCapabilities(model, template)[capability]) continue;
    const providers = names.get(model.Model) ?? [];
    if (!providers.includes(model.ProviderId)) providers.push(model.ProviderId);
    names.set(model.Model, providers);
    if (!icons.has(model.Model))
      icons.set(
        model.Model,
        modelSelectOption({
          id: model.Id,
          model: model.Model,
          providerId: model.ProviderId,
          icon: model.Icon ?? endpoint.Icon,
        }).icon,
      );
  }
  return [...names].map(([value, providers]) => ({
    value,
    label: value,
    description: providers.join(" · "),
    icon: icons.get(value),
  }));
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
    documentation: section.documentation
      ? resolveFrontendLocalizedText(section.documentation, options.locale)
      : undefined,
    fields: section.fields.map((field) => projectField(field, options.locale, modelOptions)),
  }));
}

export function projectSystemExtensionRuntimeModelAssignmentSections(options: {
  extensions: readonly SystemExtensionSettingsItem[];
  locale: FrontendLocale;
  configSnapshot: ConfigSnapshotData | null;
}): SystemExtensionRuntimeModelAssignmentSection[] {
  return options.extensions.flatMap((extension) => {
    if (!extension.enabled || !extension.configuration) return [];
    const displayName = resolveFrontendLocalizedText(extension.displayName, options.locale);
    const localized = projectSystemExtensionConfigurationSections({
      sections: extension.configuration.sections,
      locale: options.locale,
      configSnapshot: options.configSnapshot,
    });
    return namespaceRuntimeModelAssignmentSections(localized, {
      namespace: `extension:${extension.id}`,
      pathPrefix: ["Extensions", extension.id, "Configuration"],
    }).map((section) => ({
      extensionId: extension.id,
      extensionLabel: displayName,
      extensionIcon: extension.presentation.icon,
      section,
    }));
  });
}

function projectField(
  field: ConfigFormFieldData<FrontendLocalizedText>,
  locale: FrontendLocale,
  readModelOptions: (capability: ConfigFormModelCapability) => readonly ModelOption[],
): ConfigFormFieldData {
  const options = field.modelSelection ? readModelOptions(field.modelSelection.capability) : undefined;
  const projectedOptions = options ? [...options] : undefined;
  const localizedOptionLabels = field.optionLabels
    ? Object.fromEntries(
        Object.entries(field.optionLabels).map(([value, label]) => [
          value,
          resolveFrontendLocalizedText(label, locale),
        ]),
      )
    : undefined;
  return {
    ...field,
    label: resolveFrontendLocalizedText(field.label, locale),
    description: field.description ? resolveFrontendLocalizedText(field.description, locale) : undefined,
    placeholder: field.placeholder ? resolveFrontendLocalizedText(field.placeholder, locale) : undefined,
    optionLabels: localizedOptionLabels,
    ...(projectedOptions
      ? {
          options: projectedOptions.map((option) => option.value),
          optionLabels: Object.fromEntries(projectedOptions.map((option) => [option.value, option.label])),
          modelOptions: projectedOptions,
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
      .map((model) => ({
        ...modelSelectOption({
          id: model.Id,
          model: model.Model,
          providerId: model.ProviderId,
          icon: model.Icon ?? endpoints.get(model.ProviderId)?.Icon,
        }),
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
    cache.set(capability, projected);
    return projected;
  };
}
