import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { BrainCircuit, Route, Settings2 } from "lucide-react";
import { cn } from "../../lib/util";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, ScrollArea } from "../../shared/ui";
import {
  JsonConfigSettingsView,
  writeJsonConfigFieldValue,
  type JsonConfigObject,
} from "../../shared/config/JsonConfigForm";
import type { ConfigFormSectionData } from "../../api/eventTypes";
import { ModelProviderIcon, inferModelProviderIcon } from "./ModelProviderIcon";

interface ModelProviderDraft {
  Id: string;
  Model: string;
  Icon?: string;
  Capabilities?: {
    Chat?: boolean;
  };
}

export function PlanningConfigView({
  layoutMode = "panel",
  value,
  section,
  disabled,
  onChange,
}: {
  layoutMode?: "panel" | "embedded";
  value: JsonConfigObject;
  section?: ConfigFormSectionData;
  disabled?: boolean;
  onChange: (value: JsonConfigObject) => void;
}): JSX.Element {
  const models = readModels(value.ModelProviders);
  const selectedModelId = readPathString(value, ["ActionPlanner", "Client", "ModelProviderId"]) ?? "";
  const modelOptions = models
    .filter((model) => model.Id && model.Capabilities?.Chat !== false)
    .map((model) => ({
      value: model.Id,
      label: model.Model || model.Id,
      icon: model.Icon ?? inferModelProviderIcon(model.Model || model.Id),
    }));
  const nonPlannerModelSection = section
    ? {
        ...section,
        fields: section.fields.filter((field) => field.path.join(".") !== "ActionPlanner.Client.ModelProviderId"),
      }
    : undefined;

  const content = (
    <div
      className={cn("mx-auto w-full max-w-[980px] px-4 py-5 sm:px-6 sm:py-7", layoutMode === "panel" && "min-h-full")}
    >
      <div className="space-y-6">
        <section>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-900">
            <Route className="h-4 w-4 text-ink-450" />
            {frontendMessage("runtime.migrated.features.chat.PlanningConfigView.64.13")}
          </div>
          <div className="overflow-hidden border border-ink-200/70 bg-paper-100 shadow-panel">
            <div className="grid min-w-0 gap-3 bg-paper-50 px-3 py-3 md:grid-cols-[150px_minmax(0,1fr)] md:items-start">
              <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-800">
                <BrainCircuit className="h-3.5 w-3.5 text-ink-400" />
                <span className="truncate">
                  {frontendMessage("runtime.migrated.features.chat.PlanningConfigView.70.44")}
                </span>
              </div>
              <div className="min-w-0">
                <MenuSelect
                  value={selectedModelId}
                  placeholder={frontendMessage("runtime.migrated.features.chat.PlanningConfigView.75.31")}
                  options={[
                    { value: "", label: frontendMessage("runtime.migrated.features.chat.PlanningConfigView.77.41") },
                    ...modelOptions,
                  ]}
                  disabled={Boolean(disabled)}
                  onChange={(ModelProviderId) =>
                    onChange(writeOptionalPath(value, ["ActionPlanner", "Client", "ModelProviderId"], ModelProviderId))
                  }
                />
                <div className="mt-1.5 text-[11px] text-ink-450">
                  {frontendMessage("runtime.migrated.features.chat.PlanningConfigView.88.19")}
                </div>
              </div>
            </div>
          </div>
        </section>

        {nonPlannerModelSection && nonPlannerModelSection.fields.length > 0 ? (
          <JsonConfigSettingsView
            layoutMode={layoutMode}
            sections={[nonPlannerModelSection]}
            value={value}
            disabled={disabled}
            onChange={onChange}
          />
        ) : null}
      </div>
    </div>
  );

  if (layoutMode === "embedded") {
    return <div className="bg-paper-50">{content}</div>;
  }

  return (
    <ScrollArea className="h-full min-h-0 flex-1 bg-paper-50" viewportClassName="h-full">
      {content}
    </ScrollArea>
  );
}

function MenuSelect({
  value,
  placeholder,
  options,
  disabled,
  onChange,
}: {
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string; icon?: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-ink-200 bg-paper-50 px-2.5",
            "text-left text-[12.5px] text-ink-800 transition hover:border-accent-border-strong disabled:pointer-events-none disabled:opacity-55",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected?.icon ? <ModelProviderIcon icon={selected.icon} size={16} /> : null}
            <span className={cn("truncate", !selected && "text-ink-350")}>{selected?.label ?? placeholder}</span>
          </span>
          <Settings2 className="h-3.5 w-3.5 shrink-0 text-ink-350" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[320px] min-w-[280px] overflow-y-auto bg-paper-50">
        {options.map((option) => (
          <DropdownMenuItem key={option.value || "default"} onSelect={() => onChange(option.value)}>
            <span className="inline-flex min-w-0 items-center gap-2">
              {option.icon ? <ModelProviderIcon icon={option.icon} size={16} /> : null}
              <span className="truncate">{option.label}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function readModels(value: unknown): ModelProviderDraft[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((record) => ({
        Id: readString(record.Id) ?? "",
        Model: readString(record.Model) ?? "",
        Icon: readString(record.Icon),
        Capabilities: isRecord(record.Capabilities) ? { Chat: readBoolean(record.Capabilities.Chat) } : undefined,
      }))
    : [];
}

function readPathString(value: JsonConfigObject, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return readString(current);
}

function writeOptionalPath(value: JsonConfigObject, path: readonly string[], nextValue: string): JsonConfigObject {
  return writeJsonConfigFieldValue(value, path, nextValue || undefined);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
