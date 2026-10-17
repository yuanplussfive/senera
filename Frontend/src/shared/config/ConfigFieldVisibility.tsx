import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";

export type ConfigFieldVisibility = "essential" | "all";

export interface ConfigFieldPresentation {
  readonly required: boolean;
  readonly essential: boolean;
}

export function filterConfigFields<TField extends ConfigFieldPresentation>(
  fields: readonly TField[],
  visibility: ConfigFieldVisibility,
): TField[] {
  return visibility === "essential" ? fields.filter((field) => field.essential) : [...fields];
}

export function ConfigFieldVisibilityControl({
  fields,
  value,
  onChange,
}: {
  fields: readonly ConfigFieldPresentation[];
  value: ConfigFieldVisibility;
  onChange: (value: ConfigFieldVisibility) => void;
}): JSX.Element | null {
  const essentialCount = filterConfigFields(fields, "essential").length;
  if (fields.length === essentialCount) return null;

  const options: Array<{ value: ConfigFieldVisibility; label: string; count: number }> = [
    {
      value: "essential",
      label: frontendMessage("settings.config.visibilityEssential"),
      count: essentialCount,
    },
    {
      value: "all",
      label: frontendMessage("settings.config.visibilityAll"),
      count: fields.length,
    },
  ];

  return (
    <div
      role="group"
      aria-label={frontendMessage("settings.config.visibilityLabel")}
      className="grid h-8 shrink-0 grid-cols-2 rounded-md bg-ink-900/[0.05] p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={`${option.label} ${option.count}`}
          aria-pressed={value === option.value}
          className={cn(
            "inline-flex min-w-[64px] items-center justify-center rounded-[5px] px-2 text-[11.5px] transition-colors",
            value === option.value
              ? "bg-paper-50 text-ink-900 ring-1 ring-ink-900/[0.06]"
              : "text-ink-500 hover:text-ink-800",
          )}
          onClick={() => onChange(option.value)}
        >
          <span aria-hidden="true" data-label={option.label} className="before:content-[attr(data-label)]" />
        </button>
      ))}
    </div>
  );
}

export function ConfigFieldRequirementLabel({
  required,
}: Pick<ConfigFieldPresentation, "required">): JSX.Element | null {
  if (!required) return null;
  return (
    <span className="text-[10.5px] font-normal text-brick-600">{frontendMessage("settings.config.fieldRequired")}</span>
  );
}
