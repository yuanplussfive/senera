import { BrainCircuit, Settings2, SlidersHorizontal, Trash2 } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Button, Dialog, DialogContent, ScrollArea } from "../../shared/ui";
import { ModelProviderIcon, ModelProviderIconNames } from "./ModelProviderIcon";
import { readBooleanWithTemplate, readModelCapabilities, readNumberWithTemplate } from "./modelConfigData";
import type { ModelCapabilitiesDraft, ModelProviderDraft } from "./modelConfigTypes";
import { CapabilityToggle, ModelCapabilityIconItems } from "./ModelCapabilityControls";
import { MenuRow, MenuSelect, NumberRow, SectionLabel, SettingsTable, ToggleRow } from "./ModelConfigPrimitives";

export function ModelOptionsDialog({
  model,
  modelIndex,
  modelTemplate,
  defaultModelId,
  endpointOptions,
  disabled,
  onOpenChange,
  onChange,
  onCommit,
  onSetDefault,
  onRemove,
}: {
  model: ModelProviderDraft | null;
  modelIndex: number | null;
  modelTemplate: Record<string, unknown>;
  defaultModelId: string;
  endpointOptions: Array<{ value: string; label: string }>;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<ModelProviderDraft>) => void;
  onCommit: () => void;
  onSetDefault: (modelId: string) => void;
  onRemove: (index: number) => void;
}): JSX.Element {
  const open = model !== null;
  if (!model) {
    return <Dialog open={false} onOpenChange={onOpenChange} />;
  }

  const capabilities = readModelCapabilities(model, modelTemplate);
  const iconOptions = ModelProviderIconNames.map((icon) => ({ value: icon, label: icon }));
  const isDefault = model.Id === defaultModelId;
  const isSaved = modelIndex !== null;
  const temperature = readNumberWithTemplate(model.Temperature, modelTemplate, "Temperature");
  const maxOutputTokens = readNumberWithTemplate(model.MaxOutputTokens, modelTemplate, "MaxOutputTokens");
  const timeoutSeconds = readNumberWithTemplate(model.TimeoutSeconds, modelTemplate, "TimeoutSeconds");
  const firstTokenTimeoutSeconds = readNumberWithTemplate(
    model.FirstTokenTimeoutSeconds,
    modelTemplate,
    "FirstTokenTimeoutSeconds",
  );
  const maxRequestSeconds = readNumberWithTemplate(model.MaxRequestSeconds, modelTemplate, "MaxRequestSeconds");
  const maxNetworkRetries = readNumberWithTemplate(model.MaxNetworkRetries, modelTemplate, "MaxNetworkRetries");
  const contextWindowTokens = readNumberWithTemplate(model.ContextWindowTokens, modelTemplate, "ContextWindowTokens");
  const maxModelOutputTokens = readNumberWithTemplate(
    model.MaxModelOutputTokens,
    modelTemplate,
    "MaxModelOutputTokens",
  );
  const streamEnabled =
    typeof model.Stream === "boolean" ? model.Stream : readBooleanWithTemplate(modelTemplate, "Stream");

  const updateCapability = (key: keyof ModelCapabilitiesDraft, enabled: boolean): void => {
    onChange({
      Capabilities: {
        ...capabilities,
        [key]: enabled,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("config.model.optionsTitle")}
        description={model.Model}
        motionPreset="focus"
        className="h-[min(720px,calc(100dvh_-_48px))] w-[min(760px,calc(100vw_-_32px))] max-w-none rounded-xl bg-paper-50"
        bodyClassName="flex min-h-0 flex-col"
      >
        <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
          <div className="space-y-5 px-5 py-4">
            <section>
              <SectionLabel
                icon={<SlidersHorizontal className="h-4 w-4" />}
                title={frontendMessage("config.model.capabilitiesTitle")}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {ModelCapabilityIconItems.map((item) => (
                  <CapabilityToggle
                    key={item.key}
                    label={item.label}
                    icon={item.icon}
                    iconClassName={item.className}
                    enabled={capabilities[item.key]}
                    disabled={disabled}
                    onChange={(enabled) => updateCapability(item.key, enabled)}
                  />
                ))}
              </div>
            </section>

            <section>
              <SectionLabel
                icon={<BrainCircuit className="h-4 w-4" />}
                title={frontendMessage("config.model.parametersTitle")}
              />
              <SettingsTable>
                <NumberRow
                  label={frontendMessage("config.model.contextWindow")}
                  value={contextWindowTokens}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  placeholder="-1"
                  onChange={(ContextWindowTokens) => onChange({ ContextWindowTokens })}
                />
                <NumberRow
                  label={frontendMessage("config.model.maxModelOutput")}
                  value={maxModelOutputTokens}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  placeholder="-1"
                  onChange={(MaxModelOutputTokens) => onChange({ MaxModelOutputTokens })}
                />
                <MenuRow
                  icon={<Settings2 className="h-3.5 w-3.5" />}
                  label={frontendMessage("config.model.endpointProtocol")}
                >
                  <MenuSelect
                    value={model.Endpoint}
                    placeholder={frontendMessage("config.model.selectProtocol")}
                    options={endpointOptions}
                    disabled={disabled || endpointOptions.length === 0}
                    onChange={(Endpoint) => onChange({ Endpoint })}
                  />
                </MenuRow>
                <MenuRow
                  icon={<BrainCircuit className="h-3.5 w-3.5" />}
                  label={frontendMessage("config.provider.icon")}
                >
                  <MenuSelect
                    value={model.Icon ?? ""}
                    placeholder={frontendMessage("config.provider.selectIcon")}
                    options={iconOptions}
                    disabled={disabled}
                    renderValue={(value) =>
                      value ? (
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <ModelProviderIcon icon={value} size={18} />
                          <span className="truncate">{value}</span>
                        </span>
                      ) : null
                    }
                    renderOption={(option) => (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <ModelProviderIcon icon={option.value} size={16} />
                        <span className="truncate">{option.label}</span>
                      </span>
                    )}
                    onChange={(Icon) => onChange({ Icon })}
                  />
                </MenuRow>
              </SettingsTable>
            </section>

            <section>
              <SectionLabel
                icon={<SlidersHorizontal className="h-4 w-4" />}
                title={frontendMessage("config.model.runtimeParameters")}
              />
              <SettingsTable>
                <NumberRow
                  label={frontendMessage("config.model.temperature")}
                  value={temperature}
                  min={0}
                  max={2}
                  step={0.1}
                  disabled={disabled}
                  placeholder="0"
                  onChange={(Temperature) => onChange({ Temperature })}
                />
                <NumberRow
                  label={frontendMessage("config.model.maxOutput")}
                  value={maxOutputTokens}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  placeholder="-1"
                  onChange={(MaxOutputTokens) => onChange({ MaxOutputTokens })}
                />
                <ToggleRow
                  label={frontendMessage("config.model.streaming")}
                  enabled={streamEnabled}
                  disabled={disabled}
                  onChange={(Stream) => onChange({ Stream })}
                />
                <NumberRow
                  label={frontendMessage("config.model.requestTimeout")}
                  value={timeoutSeconds}
                  min={1}
                  step={1}
                  disabled={disabled}
                  placeholder="480"
                  onChange={(TimeoutSeconds) => onChange({ TimeoutSeconds })}
                />
                <NumberRow
                  label={frontendMessage("config.model.firstTokenTimeout")}
                  value={firstTokenTimeoutSeconds}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  placeholder="240"
                  onChange={(FirstTokenTimeoutSeconds) => onChange({ FirstTokenTimeoutSeconds })}
                />
                <NumberRow
                  label={frontendMessage("config.model.maxRequestTime")}
                  value={maxRequestSeconds}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  placeholder="-1"
                  onChange={(MaxRequestSeconds) => onChange({ MaxRequestSeconds })}
                />
                <NumberRow
                  label={frontendMessage("config.model.networkRetries")}
                  value={maxNetworkRetries}
                  min={0}
                  step={1}
                  disabled={disabled}
                  placeholder="1"
                  onChange={(MaxNetworkRetries) => onChange({ MaxNetworkRetries })}
                />
              </SettingsTable>
            </section>
          </div>
        </ScrollArea>

        <div className="flex shrink-0 items-center justify-between border-t border-ink-200/70 bg-paper-100 px-5 py-3">
          <button
            type="button"
            disabled={disabled || !isSaved}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition disabled:pointer-events-none disabled:opacity-50",
              isSaved
                ? "border-brick-200 bg-brick-50 text-brick-700 hover:bg-brick-100"
                : "border-ink-200 bg-paper-50 text-ink-450",
            )}
            onClick={() => {
              if (modelIndex !== null) onRemove(modelIndex);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {frontendMessage(isSaved ? "config.model.remove" : "config.model.unsaved")}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled || !isSaved || !model.Id || isDefault}
              className={cn(
                "inline-flex h-8 items-center rounded-md border px-3 text-[12px] transition",
                isDefault
                  ? "border-terra-200 bg-terra-50 text-terra-700"
                  : "border-ink-200 bg-paper-50 text-ink-650 hover:border-terra-200 hover:text-terra-700",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
              onClick={() => onSetDefault(model.Id)}
            >
              {isDefault ? "DEFAULT" : frontendMessage("config.model.setDefault")}
            </button>
            <Button size="sm" disabled={disabled} onClick={onCommit}>
              {frontendMessage(isSaved ? "config.model.done" : "config.model.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
