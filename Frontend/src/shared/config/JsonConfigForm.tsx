import { useState, type ReactNode } from "react";
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
  const visibilityControl = (
    <ConfigFieldVisibilityControl fields={allFields} value={fieldVisibility} onChange={setFieldVisibility} />
  );
  const content = (
    <div
      onBlurCapture={onCommit}
      className={cn("mx-auto w-full max-w-[960px] px-4 py-5 sm:px-6 sm:py-7", layoutMode === "panel" && "min-h-full")}
    >
      {visibleSections.length > 0 ? (
        <div className="space-y-6">
          {visibleSections.map((section, index) => (
            <JsonSettingsSection
              key={section.name}
              section={section}
              showHeading={showSectionHeading}
              headerAction={index === 0 ? visibilityControl : undefined}
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
        <div>
          <SettingsSectionHeading
            title={frontendMessage("settings.config.primaryGroupTitle")}
            action={visibilityControl}
          />
          <StateView
            status="empty"
            className="min-h-64 rounded-lg border border-line bg-paper-50"
            description={
              fieldVisibility === "essential" && allFields.length > 0
                ? frontendMessage("settings.config.noEssentialFields")
                : emptyText
            }
          />
        </div>
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
  headerAction,
  value,
  disabled,
  onUpdateField,
}: {
  section: ConfigFormSectionData;
  showHeading: boolean;
  headerAction?: ReactNode;
  value: JsonConfigObject;
  disabled: boolean;
  onUpdateField: (field: ConfigFormFieldData, value: unknown) => void;
}): JSX.Element {
  return (
    <section>
      <SettingsSectionHeading
        title={showHeading ? section.label : frontendMessage("settings.config.primaryGroupTitle")}
        description={showHeading ? section.description : undefined}
        action={headerAction}
      />
      <div
        className="divide-y divide-line-subtle overflow-hidden rounded-lg border border-line bg-paper-50"
        data-json-config-section={section.name}
      >
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

function SettingsSectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-2.5 flex min-w-0 items-end justify-between gap-4 px-0.5">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-ink-900">{title}</h3>
        {description ? <p className="mt-0.5 text-[11.5px] leading-5 text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
