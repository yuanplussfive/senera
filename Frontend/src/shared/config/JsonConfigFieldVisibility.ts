import type { ConfigFormFieldData, ConfigFormSectionData } from "../../api/eventTypes";
import { filterConfigFields, type ConfigFieldVisibility } from "./ConfigFieldVisibility";

export function projectJsonConfigFieldVisibility(
  sections: readonly ConfigFormSectionData[],
  visibility: ConfigFieldVisibility,
): {
  allFields: ConfigFormFieldData[];
  visibleSections: ConfigFormSectionData[];
} {
  const allFields = sections.flatMap((section) => section.fields);
  const visibleSections = sections
    .map((section) => ({
      ...section,
      fields: projectFields(section.fields, visibility),
    }))
    .filter((section) => section.fields.length > 0);
  return { allFields, visibleSections };
}

function projectFields(
  fields: readonly ConfigFormFieldData[],
  visibility: ConfigFieldVisibility,
): ConfigFormFieldData[] {
  return filterConfigFields(fields, visibility).map((field) => ({
    ...field,
    itemFields: field.itemFields ? projectFields(field.itemFields, visibility) : undefined,
  }));
}
