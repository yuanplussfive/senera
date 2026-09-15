import type {
  AgentConfigFormField,
  AgentConfigFormOptionCatalog,
  AgentConfigFormSection,
} from "../Types/ConfigFormTypes.js";

export interface AgentConfigFormOptionCatalogItem<TText = string> {
  readonly value: string;
  readonly label: TText;
}

export type AgentConfigFormOptionCatalogSnapshot<TText = string> = Readonly<
  Partial<Record<AgentConfigFormOptionCatalog, readonly AgentConfigFormOptionCatalogItem<TText>[]>>
>;

export function projectAgentConfigFormOptions<TText>(
  sections: readonly AgentConfigFormSection<TText>[],
  catalogs: AgentConfigFormOptionCatalogSnapshot<TText>,
): AgentConfigFormSection<TText>[] {
  return sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => projectField(field, catalogs)),
  }));
}

function projectField<TText>(
  field: AgentConfigFormField<TText>,
  catalogs: AgentConfigFormOptionCatalogSnapshot<TText>,
): AgentConfigFormField<TText> {
  const catalog = field.optionSource ? catalogs[field.optionSource.catalog] : undefined;
  const projected = catalog ? projectCatalog(catalog, field) : undefined;
  return {
    ...field,
    ...projected,
    itemFields: field.itemFields?.map((item) => projectField(item, catalogs)),
  };
}

function projectCatalog<TText>(
  catalog: readonly AgentConfigFormOptionCatalogItem<TText>[],
  field: AgentConfigFormField<TText>,
): Pick<AgentConfigFormField<TText>, "options" | "optionLabels"> {
  const values = new Set(catalog.map((entry) => entry.value));
  for (const value of readStringValues(field.value)) values.add(value);
  return {
    options: [...values],
    optionLabels: {
      ...field.optionLabels,
      ...Object.fromEntries(catalog.map((entry) => [entry.value, entry.label])),
    },
  };
}

function readStringValues(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}
