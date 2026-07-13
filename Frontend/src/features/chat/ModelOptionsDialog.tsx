import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import {
  BrainCircuit,
  Settings2,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { cn } from "../../lib/util";
import {
  Button,
  Dialog,
  DialogContent,
  ScrollArea,
} from "../../shared/ui";
import {
  ModelProviderIcon,
  ModelProviderIconNames,
} from "./ModelProviderIcon";
import {
  readBooleanWithTemplate,
  readModelCapabilities,
  readNumberWithTemplate,
} from "./modelConfigData";
import type {
  ModelCapabilitiesDraft,
  ModelProviderDraft,
} from "./modelConfigTypes";
import {
  CapabilityToggle,
  ModelCapabilityIconItems,
} from "./ModelCapabilityControls";
import {
  MenuRow,
  MenuSelect,
  NumberRow,
  SectionLabel,
  SettingsTable,
  TextRow,
  ToggleRow,
} from "./ModelConfigPrimitives";

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
  removeDisabledReason,
  commitLabels = { existing: "应用到草稿", new: "添加到草稿" },
  groupId = "",
  groupOptions = [],
  onGroupChange,
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
  onSetDefault?: (modelId: string) => void;
  onRemove: (index: number) => void;
  removeDisabledReason?: string;
  commitLabels?: { existing: string; new: string };
  groupId?: string;
  groupOptions?: Array<{ value: string; label: string; icon?: string }>;
  onGroupChange?: (groupId: string) => void;
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
  const contextWindowTokens = readNumberWithTemplate(
    model.ContextWindowTokens,
    modelTemplate,
    "ContextWindowTokens",
  );
  const maxModelOutputTokens = readNumberWithTemplate(
    model.MaxModelOutputTokens,
    modelTemplate,
    "MaxModelOutputTokens",
  );
  const streamEnabled = typeof model.Stream === "boolean"
    ? model.Stream
    : readBooleanWithTemplate(modelTemplate, "Stream");

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
        title={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.121.15")}
        description={model.Model}
        motionPreset="focus"
        className="h-[min(720px,calc(100dvh_-_48px))] w-[min(760px,calc(100vw_-_32px))] max-w-none rounded-xl bg-paper-50"
        bodyClassName="flex min-h-0 flex-col"
      >
        <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
          <div className="space-y-5 px-5 py-4">
            <section>
              <SectionLabel icon={<SlidersHorizontal className="h-4 w-4" />} title={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.130.84")} />
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
              <SectionLabel icon={<Settings2 className="h-4 w-4" />} title={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.147.76")} />
              <SettingsTable>
                <TextRow label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.149.32")} value={model.Model} disabled icon={<Settings2 className="h-3.5 w-3.5" />} />
                {onGroupChange ? (
                  <MenuRow icon={<BrainCircuit className="h-3.5 w-3.5" />} label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.151.82")}>
                    <MenuSelect
                      value={groupId}
                      placeholder={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.154.35")}
                      options={groupOptions}
                      disabled={disabled}
                      onChange={onGroupChange}
                    />
                  </MenuRow>
                ) : null}
              </SettingsTable>
            </section>

            <section>
              <SectionLabel icon={<BrainCircuit className="h-4 w-4" />} title={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.165.79")} />
              <SettingsTable>
                <NumberRow
                  label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.168.25")}
                  value={contextWindowTokens}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  placeholder="-1"
                  onChange={(ContextWindowTokens) => onChange({ ContextWindowTokens })}
                />
                <NumberRow
                  label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.177.25")}
                  value={maxModelOutputTokens}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  placeholder="-1"
                  onChange={(MaxModelOutputTokens) => onChange({ MaxModelOutputTokens })}
                />
                <MenuRow icon={<Settings2 className="h-3.5 w-3.5" />} label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.185.77")}>
                  <MenuSelect
                    value={model.Endpoint}
                    placeholder={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.188.33")}
                    options={endpointOptions}
                    disabled={disabled || endpointOptions.length === 0}
                    onChange={(Endpoint) => onChange({ Endpoint })}
                  />
                </MenuRow>
                <MenuRow icon={<BrainCircuit className="h-3.5 w-3.5" />} label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.194.80")}>
                  <MenuSelect
                    value={model.Icon ?? ""}
                    placeholder={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.197.33")}
                    options={iconOptions}
                    disabled={disabled}
                    renderValue={(value) => value ? (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <ModelProviderIcon icon={value} size={18} />
                        <span className="truncate">{value}</span>
                      </span>
                    ) : null}
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
              <SectionLabel icon={<SlidersHorizontal className="h-4 w-4" />} title={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.219.84")} />
              <SettingsTable>
                <NumberRow
                  label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.222.25")}
                  value={temperature}
                  min={0}
                  max={2}
                  step={0.1}
                  disabled={disabled}
                  placeholder="0"
                  onChange={(Temperature) => onChange({ Temperature })}
                />
                <NumberRow
                  label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.232.25")}
                  value={maxOutputTokens}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  placeholder="-1"
                  onChange={(MaxOutputTokens) => onChange({ MaxOutputTokens })}
                />
                <ToggleRow
                  label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.241.25")}
                  enabled={streamEnabled}
                  disabled={disabled}
                  onChange={(Stream) => onChange({ Stream })}
                />
                <NumberRow
                  label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.247.25")}
                  value={timeoutSeconds}
                  min={1}
                  step={1}
                  disabled={disabled}
                  placeholder="480"
                  onChange={(TimeoutSeconds) => onChange({ TimeoutSeconds })}
                />
                <NumberRow
                  label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.256.25")}
                  value={firstTokenTimeoutSeconds}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  placeholder="240"
                  onChange={(FirstTokenTimeoutSeconds) => onChange({ FirstTokenTimeoutSeconds })}
                />
                <NumberRow
                  label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.265.25")}
                  value={maxRequestSeconds}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  placeholder="-1"
                  onChange={(MaxRequestSeconds) => onChange({ MaxRequestSeconds })}
                />
                <NumberRow
                  label={frontendMessage("runtime.migrated.features.chat.ModelOptionsDialog.274.25")}
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
            disabled={disabled || !isSaved || Boolean(removeDisabledReason)}
            title={removeDisabledReason}
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
            {removeDisabledReason ? "先更换默认" : isSaved ? "移除" : "未保存"}
          </button>
          <div className="flex items-center gap-2">
            {onSetDefault ? (
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
                {isDefault ? "DEFAULT" : "设为默认"}
              </button>
            ) : null}
            <Button
              size="sm"
              disabled={disabled}
              onClick={onCommit}
            >
              {isSaved ? commitLabels.existing : commitLabels.new}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
