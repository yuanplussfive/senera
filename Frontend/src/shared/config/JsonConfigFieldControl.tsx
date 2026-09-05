import type { ConfigFormFieldData } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { SettingsControlRow } from "../ui/SettingsControlRow";
import { ConfigFieldRequirementLabel } from "./ConfigFieldVisibility";
import { renderJsonConfigFieldInput } from "./JsonConfigFieldInput";

export function JsonConfigFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ConfigFormFieldData;
  value: unknown;
  disabled: boolean;
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
          control={renderJsonConfigFieldInput(field, value ?? field.defaultValue, disabled, onChange)}
          controlClassName="md:max-w-[320px]"
        />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "grid min-h-[64px] min-w-0 gap-3 px-4 py-3 sm:px-5 md:grid-cols-[minmax(220px,1fr)_minmax(260px,380px)]",
        field.type === "array" || field.type === "record" ? "md:items-start" : "md:items-center",
        wide && "md:grid-cols-1 md:gap-3 md:px-5 md:py-4",
      )}
      data-json-config-field={field.path.join(".")}
    >
      <div className={cn("min-w-0 pr-2", wide && "pr-0")}>
        {label}
        {field.description ? <p className="mt-0.5 text-[11.5px] leading-5 text-ink-500">{field.description}</p> : null}
      </div>
      <div className={cn("min-w-0 md:justify-self-end", wide && "md:w-full md:justify-self-stretch")}>
        {renderJsonConfigFieldInput(field, value ?? field.defaultValue, disabled, onChange)}
      </div>
    </div>
  );
}
