import { useState } from "react";
import type { ConfigFormFieldData, ConfigFormSectionData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { ScrollArea } from "../ui";
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
  emptyText = "没有可视化配置项",
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
        <>
          {visibleSections.length > 1 ? <JsonSectionNavigation sections={visibleSections} /> : null}
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
        </>
      ) : (
        <div className="grid min-h-64 place-items-center border-y border-ink-200/70 bg-paper-50 text-[13px] text-ink-400">
          {fieldVisibility === "essential" && allFields.length > 0
            ? frontendMessage("settings.config.noEssentialFields")
            : emptyText}
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

function JsonSectionNavigation({ sections }: { sections: ConfigFormSectionData[] }): JSX.Element {
  return (
    <nav
      aria-label={frontendMessage("settings.config.sectionNavigation")}
      className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-200/70 pb-2"
    >
      <span className="text-[11px] font-medium text-ink-450">
        {frontendMessage("settings.config.sectionNavigation")}:
      </span>
      {sections.map((section) => (
        <a
          key={section.name}
          href={`#${jsonSectionAnchorId(section.name)}`}
          className="text-[11.5px] text-content-secondary underline decoration-ink-300 underline-offset-2 transition hover:text-content-primary"
        >
          {section.label}
        </a>
      ))}
    </nav>
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
    <section id={jsonSectionAnchorId(section.name)} className="scroll-mt-3">
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

function jsonSectionAnchorId(name: string): string {
  return `json-config-section-${name.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}
