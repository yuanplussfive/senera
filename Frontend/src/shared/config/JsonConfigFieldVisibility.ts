import type { ConfigFormFieldData, ConfigFormSectionData } from "../../api/eventTypes";
import { filterConfigFields, type ConfigFieldVisibility } from "./ConfigFieldVisibility";
import { isJsonConfigFieldVisible, type JsonConfigObject } from "./JsonConfigValue";

export function projectJsonConfigFieldVisibility(
  sections: readonly ConfigFormSectionData[],
  visibility: ConfigFieldVisibility,
  value: JsonConfigObject = {},
): {
  allFields: ConfigFormFieldData[];
  visibleSections: ConfigFormSectionData[];
} {
  const allFields = sections.flatMap((section) => section.fields);
  const visibleSections = sections
    .map((section) => ({
      ...section,
      fields: projectFields(section.fields, visibility, value, allFields),
    }))
    .filter((section) => section.fields.length > 0);
  return { allFields, visibleSections };
}

function projectFields(
  fields: readonly ConfigFormFieldData[],
  visibility: ConfigFieldVisibility,
  value: JsonConfigObject,
  allFields: readonly ConfigFormFieldData[],
): ConfigFormFieldData[] {
  return filterConfigFields(fields, visibility)
    .filter((field) => isJsonConfigFieldVisible(field, value, allFields))
    .map((field) => ({
      ...field,
      itemFields: field.itemFields ? projectFields(field.itemFields, visibility, value, allFields) : undefined,
    }));
}
