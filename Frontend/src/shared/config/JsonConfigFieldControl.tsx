import type { ConfigFormFieldData } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { SettingsControlRow } from "../ui/SettingsControlRow";
import { ConfigFieldRequirementLabel } from "./ConfigFieldVisibility";
import { renderJsonConfigFieldInput } from "./JsonConfigFieldInput";

export function JsonConfigFieldControl({
  field,
  value,
  disabled,
  readSecret,
  onChange,
}: {
  field: ConfigFormFieldData;
  value: unknown;
  disabled: boolean;
  readSecret?: (field: ConfigFormFieldData) => Promise<string>;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const wide = field.type === "array" && field.itemType === "table";
  const complex = field.type === "array" || field.type === "record" || wide;
  const label = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className={cn("min-w-0 text-[13px] font-medium text-content-primary", wide && "text-[13.5px]")}>
        {field.label}
      </span>
      <ConfigFieldRequirementLabel required={field.required} />
    </span>
  );
  if (!complex) {
    return (
      <div data-json-config-field={field.path.join(".")}>
        <SettingsControlRow
          label={label}
          description={field.description}
          control={renderJsonConfigFieldInput(field, value ?? field.defaultValue, disabled, onChange, readSecret)}
          controlClassName="md:max-w-[320px]"
        />
      </div>
    );
  }
  return (
    <div data-json-config-field={field.path.join(".")}>
      {wide ? (
        <div className="grid min-w-0 gap-3 px-4 py-3 sm:px-5 md:gap-3 md:px-5 md:py-4">
          <div className="min-w-0">
            {label}
            {field.description ? (
              <p className="mt-0.5 text-[11.5px] leading-5 text-ink-500">{field.description}</p>
            ) : null}
          </div>
          <div className="min-w-0 w-full">
            {renderJsonConfigFieldInput(field, value ?? field.defaultValue, disabled, onChange, readSecret)}
          </div>
        </div>
      ) : (
        <SettingsControlRow
          label={label}
          description={field.description}
          control={renderJsonConfigFieldInput(field, value ?? field.defaultValue, disabled, onChange, readSecret)}
          controlClassName={cn(
            "md:max-w-[320px]",
            field.type === "array" || field.type === "record" ? "md:items-start" : undefined,
          )}
          className="min-h-[64px] px-4 py-3 sm:px-5"
        />
      )}
    </div>
  );
}
