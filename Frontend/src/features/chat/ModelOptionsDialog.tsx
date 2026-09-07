import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import AdjustmentsHorizontalIcon from "@heroicons/react/24/outline/AdjustmentsHorizontalIcon";
import ArrowsRightLeftIcon from "@heroicons/react/24/outline/ArrowsRightLeftIcon";
import CommandLineIcon from "@heroicons/react/24/outline/CommandLineIcon";
import CpuChipIcon from "@heroicons/react/24/outline/CpuChipIcon";
import SwatchIcon from "@heroicons/react/24/outline/SwatchIcon";
import WrenchScrewdriverIcon from "@heroicons/react/24/outline/WrenchScrewdriverIcon";
import { Trash2 } from "lucide-react";
import type { ModelsDevModelMetadata } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { Button, Dialog, DialogContent, InlineError, MenuSelect, ScrollArea, Tooltip } from "../../shared/ui";
import { ModelProviderIconNames } from "./ModelProviderIcon";
import {
  readBooleanWithTemplate,
  readModelCapabilities,
  readModelToolPlanningMode,
  readNumberWithTemplate,
} from "./modelConfigData";
import type { ModelCapabilitiesDraft, ModelProviderDraft } from "./modelConfigTypes";
import { CapabilityToggle, ModelCapabilityIconItems, ToolPlanningModeControl } from "./ModelCapabilityControls";
import {
  IconOption,
  MenuRow,
  ModelsDevMetadataSummary,
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
  onCommitDraft,
  onSetDefault,
  onRemove,
  removeDisabledReason,
  errorMessage,
  discardAction,
  catalogMetadata,
  commitLabels = {
    existing: frontendMessage("config.model.applyToDraft"),
    new: frontendMessage("config.model.addToDraft"),
  },
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
  onCommitDraft?: () => void;
  onSetDefault?: (modelId: string) => void;
  onRemove: (index: number) => void;
  removeDisabledReason?: string;
  /** Last save failure for this model, shown above the footer actions. */
  errorMessage?: string | null;
  /** Escape hatch when the save-on-close cycle cannot complete. */
  discardAction?: { label: string; onDiscard: () => void };
  /** Read-only public model facts from models.dev. */
  catalogMetadata?: ModelsDevModelMetadata;
  commitLabels?: { existing: string; new: string };
}): JSX.Element {
  const open = model !== null;
  if (!model) {
    return <Dialog open={false} onOpenChange={onOpenChange} />;
  }

  const capabilities = readModelCapabilities(model, modelTemplate);
  const toolPlanningMode = readModelToolPlanningMode(model, modelTemplate);
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
  const retryBaseDelaySeconds = readNumberWithTemplate(
    model.RetryBaseDelaySeconds,
    modelTemplate,
    "RetryBaseDelaySeconds",
  );
  const retryMaxDelaySeconds = readNumberWithTemplate(
    model.RetryMaxDelaySeconds,
    modelTemplate,
    "RetryMaxDelaySeconds",
  );
  const retryAfterMaxDelaySeconds = readNumberWithTemplate(
    model.RetryAfterMaxDelaySeconds,
    modelTemplate,
    "RetryAfterMaxDelaySeconds",
  );
  const maxResponseBytes = readNumberWithTemplate(model.MaxResponseBytes, modelTemplate, "MaxResponseBytes");
  const maxSseEventBytes = readNumberWithTemplate(model.MaxSseEventBytes, modelTemplate, "MaxSseEventBytes");
  const maxSseEvents = readNumberWithTemplate(model.MaxSseEvents, modelTemplate, "MaxSseEvents");
  const contextWindowTokens = readNumberWithTemplate(model.ContextWindowTokens, modelTemplate, "ContextWindowTokens");
  const maxModelOutputTokens = readNumberWithTemplate(
    model.MaxModelOutputTokens,
    modelTemplate,
    "MaxModelOutputTokens",
  );
  const catalogOutputLimit = catalogMetadata?.outputLimit ? String(catalogMetadata.outputLimit) : undefined;
  const catalogContextLimit = catalogMetadata?.contextLimit ? String(catalogMetadata.contextLimit) : undefined;
  const streamEnabled =
    typeof model.Stream === "boolean" ? model.Stream : (readBooleanWithTemplate(modelTemplate, "Stream") ?? true);

  const updateCapability = (key: keyof ModelCapabilitiesDraft, enabled: boolean): void => {
    onChange({
      Capabilities: {
        ...capabilities,
        [key]: enabled,
      },
      ...(key === "ToolCalling" && !enabled && toolPlanningMode === "native"
        ? { ToolPlanningMode: "baml" as const }
        : {}),
    });
  };

  const updateToolPlanningMode = (ToolPlanningMode: "native" | "baml"): void => {
    onChange({
      ToolPlanningMode,
      ...(ToolPlanningMode === "native"
        ? {
            Stream: true,
            Capabilities: {
              ...capabilities,
              ToolCalling: true,
            },
          }
        : {}),
    });
  };

  const removeButton = (
    <button
      type="button"
      disabled={disabled || !isSaved || Boolean(removeDisabledReason)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition disabled:pointer-events-none disabled:opacity-50",
        isSaved
          ? "border-ink-200 bg-paper-50 text-brick-600 hover:border-brick-200 hover:bg-brick-50 hover:text-brick-700"
          : "border-ink-200 bg-paper-50 text-ink-500",
      )}
      onClick={() => {
        if (modelIndex !== null) onRemove(modelIndex);
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
      {removeDisabledReason
        ? frontendMessage("config.model.changeDefaultFirst")
        : isSaved
          ? frontendMessage("config.model.remove")
          : frontendMessage("config.model.unsaved")}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("config.model.optionsTitle")}
        description={model.Model}
        motionPreset="focus"
        className="h-[min(720px,calc(100dvh_-_48px))] w-[min(760px,calc(100vw_-_32px))] max-w-none rounded-lg bg-paper-50"
        bodyClassName="flex min-h-0 flex-col"
      >
        <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
          <div className="space-y-5 px-5 py-4" onBlurCapture={onCommitDraft}>
            <section>
              <SectionLabel
                icon={<WrenchScrewdriverIcon className="h-4 w-4" />}
                title={frontendMessage("config.model.toolPlanningTitle")}
              />
              <ToolPlanningModeControl value={toolPlanningMode} disabled={disabled} onChange={updateToolPlanningMode} />
            </section>

            <section>
              <SectionLabel
                icon={<AdjustmentsHorizontalIcon className="h-4 w-4" />}
                title={frontendMessage("config.model.capabilitiesTitle")}
              />
              <div className="grid gap-x-4 gap-y-1 border-y border-ink-200/75 py-1 sm:grid-cols-2 lg:grid-cols-3">
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
                icon={<CpuChipIcon className="h-4 w-4" />}
                title={frontendMessage("config.model.identityTitle")}
              />
              <SettingsTable>
                <TextRow
                  label={frontendMessage("config.model.modelId")}
                  value={model.Model}
                  disabled
                  icon={<CommandLineIcon className="h-3.5 w-3.5" />}
                />
              </SettingsTable>
              <ModelsDevMetadataSummary metadata={catalogMetadata} />
            </section>

            <section>
              <SectionLabel
                icon={<CpuChipIcon className="h-4 w-4" />}
                title={frontendMessage("config.model.parametersTitle")}
              />
              <SettingsTable>
                <NumberRow
                  label={frontendMessage("config.model.contextWindow")}
                  value={contextWindowTokens}
                  min={1}
                  step={1}
                  disabled={disabled}
                  placeholder={catalogContextLimit ?? "128000"}
                  onChange={(ContextWindowTokens) => onChange({ ContextWindowTokens })}
                />
                <NumberRow
                  label={frontendMessage("config.model.maxModelOutput")}
                  value={maxModelOutputTokens}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  placeholder={catalogOutputLimit ?? "-1"}
                  onChange={(MaxModelOutputTokens) => onChange({ MaxModelOutputTokens })}
                />
                <MenuRow
                  icon={<ArrowsRightLeftIcon className="h-3.5 w-3.5" />}
                  label={frontendMessage("config.model.endpointProtocol")}
                >
                  <MenuSelect
                    value={model.Endpoint}
                    placeholder={frontendMessage("config.model.selectProtocol")}
                    ariaLabel={frontendMessage("config.model.endpointProtocol")}
                    options={endpointOptions}
                    disabled={disabled || endpointOptions.length === 0}
                    onChange={(Endpoint) => onChange({ Endpoint })}
                  />
                </MenuRow>
                <MenuRow icon={<SwatchIcon className="h-3.5 w-3.5" />} label={frontendMessage("config.model.icon")}>
                  <MenuSelect
                    value={model.Icon ?? ""}
                    placeholder={frontendMessage("config.model.selectIcon")}
                    ariaLabel={frontendMessage("config.model.icon")}
                    options={iconOptions}
                    disabled={disabled}
                    renderValue={(value) => (value ? <IconOption value={value} label={value} size={18} /> : null)}
                    renderOption={(option) => <IconOption value={option.value} label={option.label} size={16} />}
                    onChange={(Icon) => onChange({ Icon })}
                  />
                </MenuRow>
              </SettingsTable>
            </section>

            <section>
              <SectionLabel
                icon={<AdjustmentsHorizontalIcon className="h-4 w-4" />}
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
                  placeholder={catalogOutputLimit ?? "-1"}
                  onChange={(MaxOutputTokens) => onChange({ MaxOutputTokens })}
                />
                <ToggleRow
                  label={frontendMessage("config.model.streaming")}
                  enabled={streamEnabled}
                  disabled={disabled}
                  onChange={(Stream) =>
                    onChange({
                      Stream,
                      ...(!Stream && toolPlanningMode === "native" ? { ToolPlanningMode: "baml" as const } : {}),
                    })
                  }
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
                  label={frontendMessage("config.model.maxResponseBytes")}
                  value={maxResponseBytes}
                  min={1}
                  step={1048576}
                  disabled={disabled}
                  placeholder="67108864"
                  onChange={(MaxResponseBytes) => onChange({ MaxResponseBytes })}
                />
                <NumberRow
                  label={frontendMessage("config.model.maxSseEventBytes")}
                  value={maxSseEventBytes}
                  min={1}
                  step={1048576}
                  disabled={disabled}
                  placeholder="8388608"
                  onChange={(MaxSseEventBytes) => onChange({ MaxSseEventBytes })}
                />
                <NumberRow
                  label={frontendMessage("config.model.maxSseEvents")}
                  value={maxSseEvents}
                  min={1}
                  step={1}
                  disabled={disabled}
                  placeholder="100000"
                  onChange={(MaxSseEvents) => onChange({ MaxSseEvents })}
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
                <NumberRow
                  label={frontendMessage("config.model.retryBaseDelay")}
                  value={retryBaseDelaySeconds}
                  min={0.001}
                  step={0.05}
                  disabled={disabled}
                  placeholder="0.25"
                  onChange={(RetryBaseDelaySeconds) => onChange({ RetryBaseDelaySeconds })}
                />
                <NumberRow
                  label={frontendMessage("config.model.retryMaxDelay")}
                  value={retryMaxDelaySeconds}
                  min={0.001}
                  step={1}
                  disabled={disabled}
                  placeholder="10"
                  onChange={(RetryMaxDelaySeconds) => onChange({ RetryMaxDelaySeconds })}
                />
                <NumberRow
                  label={frontendMessage("config.model.retryAfterMaxDelay")}
                  value={retryAfterMaxDelaySeconds}
                  min={0.001}
                  step={1}
                  disabled={disabled}
                  placeholder="60"
                  onChange={(RetryAfterMaxDelaySeconds) => onChange({ RetryAfterMaxDelaySeconds })}
                />
              </SettingsTable>
            </section>
          </div>
        </ScrollArea>

        <div className="shrink-0 border-t border-ink-200/70 bg-paper-100 px-5 py-3">
          {errorMessage ? <InlineError className="mb-2">{errorMessage}</InlineError> : null}
          <div className="flex items-center justify-between">
            {removeDisabledReason ? (
              <Tooltip content={removeDisabledReason} side="top">
                <span className="inline-flex">{removeButton}</span>
              </Tooltip>
            ) : (
              removeButton
            )}
            <div className="flex items-center gap-2">
              {discardAction ? (
                <Button size="sm" variant="outline" onClick={discardAction.onDiscard}>
                  {discardAction.label}
                </Button>
              ) : null}
              {onSetDefault ? (
                <button
                  type="button"
                  disabled={disabled || !isSaved || !model.Id || isDefault}
                  className={cn(
                    "inline-flex h-8 items-center rounded-md border px-3 text-[12px] transition",
                    isDefault
                      ? "border-accent-border bg-accent-surface text-accent-content"
                      : "border-ink-200 bg-paper-50 text-ink-650 hover:border-accent-border-strong hover:text-accent-content-hover",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                  onClick={() => onSetDefault(model.Id)}
                >
                  {isDefault ? frontendMessage("config.model.default") : frontendMessage("config.model.setDefault")}
                </button>
              ) : null}
              <Button size="sm" disabled={disabled} onClick={onCommit}>
                {isSaved ? commitLabels.existing : commitLabels.new}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
