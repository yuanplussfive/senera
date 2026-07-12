import type { ConfigFormFieldData, ConfigFormSectionData } from "../../api/eventTypes";
import { ScrollArea } from "../ui";
import { JsonFieldControl } from "./JsonConfigFieldControls";
import {
  normalizeFieldValue,
  readDraftOrEffectiveValue,
  writeJsonConfigFieldValue,
  type JsonConfigObject,
} from "./jsonConfigFormModel";
import { validateJsonConfigDraft } from "./jsonConfigFormValidation";
import { jsonConfigFormMessages } from "./jsonConfigFormMessages";

export { validateJsonConfigDraft, writeJsonConfigFieldValue };
export type { JsonConfigObject } from "./jsonConfigFormModel";

export function JsonConfigSettingsView({
  sections,
  value,
  disabled,
  emptyText = jsonConfigFormMessages.empty(),
  onChange,
}: {
  sections: ConfigFormSectionData[];
  value: JsonConfigObject;
  disabled?: boolean;
  emptyText?: string;
  onChange: (value: JsonConfigObject) => void;
}): JSX.Element {
  const visibleSections = sections.filter((section) => section.fields.length > 0);

  return (
    <ScrollArea className="h-full min-h-0 flex-1 bg-paper-50" viewportClassName="h-full">
      <div className="mx-auto min-h-full w-full max-w-[1180px] px-4 py-5 sm:px-6 sm:py-7">
        {visibleSections.length > 0 ? (
          <div className="space-y-7">
            {visibleSections.map((section, sectionIndex) => (
              <JsonSettingsSection
                key={section.name}
                section={section}
                sectionIndex={sectionIndex}
                value={value}
                disabled={Boolean(disabled)}
                onUpdateField={(field, nextValue) =>
                  onChange(writeJsonConfigFieldValue(value, field.path, normalizeFieldValue(field, nextValue)))
                }
              />
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center border border-ink-200/70 bg-paper-50 text-[13px] text-ink-400 shadow-panel">
            {emptyText}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
function JsonSettingsSection({
  section,
  sectionIndex,
  value,
  disabled,
  onUpdateField,
}: {
  section: ConfigFormSectionData;
  sectionIndex: number;
  value: JsonConfigObject;
  disabled: boolean;
  onUpdateField: (field: ConfigFormFieldData, value: unknown) => void;
}): JSX.Element {
  return (
    <section>
      <div className="mb-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 px-0.5">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-ink-900">{section.label}</h3>
          {section.description ? (
            <p className="mt-0.5 text-[12px] leading-5 text-ink-500">{section.description}</p>
          ) : null}
        </div>
        <span className="pb-0.5 font-mono text-[10.5px] text-ink-350">{String(sectionIndex + 1).padStart(2, "0")}</span>
      </div>

      <div className="overflow-hidden border border-ink-200/70 bg-paper-100 shadow-panel">
        {section.fields.map((field) => (
          <JsonFieldControl
            key={field.path.join("\u001f")}
            field={field}
            value={readDraftOrEffectiveValue(value, field)}
            disabled={disabled}
            onChange={(nextValue) => onUpdateField(field, nextValue)}
          />
        ))}
      </div>
    </section>
  );
}
