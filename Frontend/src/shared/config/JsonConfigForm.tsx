import { useState } from "react";
import type { ConfigFormFieldData, ConfigFormSectionData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { ScrollArea, StateView } from "../ui";
import { ConfigFieldVisibilityControl, type ConfigFieldVisibility } from "./ConfigFieldVisibility";
import { JsonConfigFieldControl } from "./JsonConfigFieldControl";
import { projectJsonConfigFieldVisibility } from "./JsonConfigFieldVisibility";
import {
  normalizeJsonConfigFieldValue,
  readDraftOrEffectiveValue,
  writeJsonConfigFieldValue,
  type JsonConfigObject,
} from "./JsonConfigValue";

export type { JsonConfigObject } from "./JsonConfigValue";
export { writeJsonConfigFieldValue } from "./JsonConfigValue";
export { validateJsonConfigDraft } from "./JsonConfigValidation";

export function JsonConfigSettingsView({
  layoutMode = "panel",
  sections,
  showSectionHeading = true,
  value,
  disabled,
  emptyText = frontendMessage("config.form.empty"),
  onChange,
  onCommit,
}: {
  layoutMode?: "panel" | "embedded";
  sections: ConfigFormSectionData[];
  showSectionHeading?: boolean;
  value: JsonConfigObject;
  disabled?: boolean;
  emptyText?: string;
  onChange: (value: JsonConfigObject, mode?: "debounced" | "immediate") => void;
  onCommit?: () => void;
}): JSX.Element {
  const [fieldVisibility, setFieldVisibility] = useState<ConfigFieldVisibility>("essential");
  const { allFields, visibleSections } = projectJsonConfigFieldVisibility(sections, fieldVisibility);
  const content = (
    <div
      onBlurCapture={onCommit}
      className={cn("mx-auto w-full max-w-[1180px] px-4 py-5 sm:px-6 sm:py-7", layoutMode === "panel" && "min-h-full")}
    >
      <ConfigFieldVisibilityControl fields={allFields} value={fieldVisibility} onChange={setFieldVisibility} />
      {visibleSections.length > 0 ? (
        <div className="space-y-7">
          {visibleSections.map((section) => (
            <JsonSettingsSection
              key={section.name}
              section={section}
              showHeading={showSectionHeading}
              value={value}
              disabled={Boolean(disabled)}
              onUpdateField={(field, nextValue) =>
                onChange(
                  writeJsonConfigFieldValue(value, field.path, normalizeJsonConfigFieldValue(field, nextValue)),
                  field.type === "boolean" || Boolean(field.options?.length) ? "immediate" : "debounced",
                )
              }
            />
          ))}
        </div>
      ) : (
        <StateView
          status="empty"
          className="min-h-64 border-y border-ink-200/70 bg-paper-50"
          description={
            fieldVisibility === "essential" && allFields.length > 0
              ? frontendMessage("settings.config.noEssentialFields")
              : emptyText
          }
        />
      )}
    </div>
  );

  if (layoutMode === "embedded") return <div className="bg-paper-50">{content}</div>;
  return (
    <ScrollArea className="h-full min-h-0 flex-1 bg-paper-50" viewportClassName="h-full">
      {content}
    </ScrollArea>
  );
}

function JsonSettingsSection({
  section,
  showHeading,
  value,
  disabled,
  onUpdateField,
}: {
  section: ConfigFormSectionData;
  showHeading: boolean;
  value: JsonConfigObject;
  disabled: boolean;
  onUpdateField: (field: ConfigFormFieldData, value: unknown) => void;
}): JSX.Element {
  return (
    <section>
      {showHeading ? (
        <div className="mb-2 min-w-0 px-0.5">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-ink-900">{section.label}</h3>
            {section.description ? (
              <p className="mt-0.5 text-[12px] leading-5 text-ink-500">{section.description}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="border-y border-ink-200/70 bg-paper-100">
        {section.fields.map((field) => (
          <JsonConfigFieldControl
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
