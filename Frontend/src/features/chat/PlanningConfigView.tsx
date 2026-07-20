import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { BrainCircuit, Route } from "lucide-react";
import { cn } from "../../lib/util";
import { MenuSelect, ScrollArea } from "../../shared/ui";
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
          <div className="border-y border-ink-200/70 bg-paper-100">
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
                  ariaLabel={frontendMessage("runtime.migrated.features.chat.PlanningConfigView.70.44")}
                  options={[
                    { value: "", label: frontendMessage("runtime.migrated.features.chat.PlanningConfigView.77.41") },
                    ...modelOptions,
                  ]}
                  disabled={Boolean(disabled)}
                  size="md"
                  renderValue={(value, option) => {
                    const current = modelOptions.find((entry) => entry.value === value);
                    return current ? (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <ModelProviderIcon icon={current.icon} size={16} />
                        <span className="truncate">{current.label}</span>
                      </span>
                    ) : (
                      <span className="truncate">{option?.label}</span>
                    );
                  }}
                  renderOption={(option) => {
                    const current = modelOptions.find((entry) => entry.value === option.value);
                    return current ? (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <ModelProviderIcon icon={current.icon} size={16} />
                        <span className="truncate">{current.label}</span>
                      </span>
                    ) : (
                      <span className="truncate">{option.label}</span>
                    );
                  }}
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
