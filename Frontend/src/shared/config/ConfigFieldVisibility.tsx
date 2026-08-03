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
    <div className="mb-5 flex min-w-0 items-center justify-between gap-3 border-b border-ink-200/70 pb-3">
      <span className="text-[11.5px] font-medium text-ink-500">
        {frontendMessage("settings.config.visibilityLabel")}
      </span>
      <div
        role="group"
        aria-label={frontendMessage("settings.config.visibilityLabel")}
        className="grid h-8 shrink-0 grid-cols-2 rounded-lg bg-ink-900/[0.055] p-1"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            className={cn(
              "inline-flex min-w-[74px] items-center justify-center gap-1 rounded-md px-2 text-[11.5px] transition",
              value === option.value ? "bg-paper-50 text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800",
            )}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
            <span className={cn("font-mono text-[10px]", value === option.value ? "text-ink-500" : "text-ink-350")}>
              {option.count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConfigFieldRequirementLabel({ required }: Pick<ConfigFieldPresentation, "required">): JSX.Element {
  return (
    <span className={cn("text-[10.5px] font-normal", required ? "text-brick-600" : "text-ink-350")}>
      {frontendMessage(required ? "settings.config.fieldRequired" : "settings.config.fieldOptional")}
    </span>
  );
}
