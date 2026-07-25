import type { ConfigFormFieldData } from "../../api/eventTypes";
import { cn } from "../../lib/util";
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
  return (
    <div
      className={cn(
        "grid min-w-0 gap-3 border-t border-ink-200/65 px-4 py-3.5 first:border-t-0 md:grid-cols-[minmax(220px,1fr)_minmax(290px,420px)]",
        field.type === "array" || field.type === "record" ? "md:items-start" : "md:items-center",
        wide && "md:grid-cols-1 md:gap-3 md:px-4 md:py-4",
      )}
    >
      <div className={cn("min-w-0 pr-2", wide && "pr-0")}>
        <div className="flex min-w-0 items-baseline gap-2">
          <div className={cn("min-w-0 text-[13px] font-medium text-ink-900", wide && "text-[13.5px]")}>
            {field.label}
          </div>
          <ConfigFieldRequirementLabel required={field.required} />
        </div>
        {field.description ? <p className="mt-1 text-[12px] leading-5 text-ink-500">{field.description}</p> : null}
      </div>
      <div className={cn("min-w-0 md:justify-self-end", wide && "md:w-full md:justify-self-stretch")}>
        {renderJsonConfigFieldInput(field, value ?? field.defaultValue, disabled, onChange)}
      </div>
    </div>
  );
}
