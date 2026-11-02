import type { ConfigFormFieldData } from "../../api/eventTypes";
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
  const complex = field.type === "array" || field.type === "record";
  const label = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="min-w-0 text-[13px] font-medium text-content-primary">{field.label}</span>
      <ConfigFieldRequirementLabel required={field.required} />
    </span>
  );
  return (
    <div data-json-config-field={field.path.join(".")}>
      <SettingsControlRow
        label={label}
        description={field.description}
        layout={complex ? "stacked" : "inline"}
        control={renderJsonConfigFieldInput(field, value ?? field.defaultValue, disabled, onChange, readSecret)}
      />
    </div>
  );
}
