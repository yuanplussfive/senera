import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendModelConfigMessage } from "../../i18n/frontendModelConfigMessageCatalog";
import { AgentImageGenerationApis } from "../../api/generatedModelCapabilityContract";
import type { ModelsDevModelMetadata } from "../../api/eventTypes";
import { useId, useState } from "react";
import { cn } from "../../lib/util";
import { MotionDisclosure } from "../../shared/motion";
import { AppIcon, Button, Dialog, DialogContent, InlineError, MenuSelect, ScrollArea } from "../../shared/ui";
import { ModelProviderIconNames } from "../../shared/models/ModelProviderIcon";
import { ModelThinkingControls } from "./ModelThinkingControls";
import { ModelContextWindowControl } from "./ModelContextWindowControl";
import {
  readModelInvocationCapabilities,
  readModelToolPlanningMode,
  readNumber,
  readNumberWithTemplate,
} from "./modelConfigData";
import type {
  ModelBooleanCapabilityKey,
  ModelCapabilitiesDraft,
  ModelProviderDraft,
  ModelVisionInputDraft,
} from "./modelConfigTypes";
import { CapabilityToggle, ModelCapabilityIconItems, ToolPlanningModeControl } from "./ModelCapabilityControls";
import {
  AnimatedVisionFormatPresets,
  ModelVisionFormatEditor,
  PortableStaticVisionFormats,
  StaticVisionFormatPresets,
} from "./ModelVisionFormatEditor";
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

const AdvancedRuntimeKeys = [
  "MaxRequestSeconds",
  "MaxResponseBytes",
  "MaxSseEventBytes",
  "MaxSseEvents",
  "MaxNetworkRetries",
  "RetryBaseDelaySeconds",
  "RetryMaxDelaySeconds",
  "RetryAfterMaxDelaySeconds",
] as const satisfies readonly (keyof ModelProviderDraft)[];

export function ModelOptionsDialog({
  model,
  modelIndex,
  modelTemplate,
  endpointOptions,
  disabled,
  onOpenChange,
  onChange,
  onCommit,
  onCommitDraft,
  onRemove,
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
  endpointOptions: Array<{ value: string; label: string }>;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<ModelProviderDraft>) => void;
  onCommit: () => void;
  onCommitDraft?: () => void;
  onRemove: (index: number) => void;
  /** Last save failure for this model, shown above the footer actions. */
  errorMessage?: string | null;
  /** Escape hatch when the save-on-close cycle cannot complete. */
  discardAction?: { label: string; onDiscard: () => void };
  /** Read-only public model facts from models.dev. */
  catalogMetadata?: ModelsDevModelMetadata;
  commitLabels?: { existing: string; new: string };
}): JSX.Element {
  const [advancedRuntimeOpen, setAdvancedRuntimeOpen] = useState(false);
  const runtimeAdvancedId = useId();
  const open = model !== null;
  if (!model) {
    return <Dialog open={false} onOpenChange={onOpenChange} />;
  }

  const { Stream: streamEnabled, ...capabilities } = readModelInvocationCapabilities(
    model,
    modelTemplate,
    catalogMetadata,
  );
  const toolPlanningMode = readModelToolPlanningMode(model, modelTemplate);
  const iconOptions = ModelProviderIconNames.map((icon) => ({ value: icon, label: icon }));
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
  const reasoningEnabled = capabilities.Reasoning === true;
  const visionInput = model.Capabilities?.VisionInput;
  const advancedRuntimeOverrideCount = AdvancedRuntimeKeys.filter((key) => {
    const declared = readNumber(model[key]);
    return declared !== undefined && declared !== readNumber(modelTemplate[key]);
  }).length;

  const updateCapability = (key: ModelBooleanCapabilityKey, enabled: boolean): void => {
    onChange({
      Capabilities: {
        ...model.Capabilities,
        [key]: enabled,
      },
    });
  };

  const updateToolPlanningMode = (ToolPlanningMode: "native" | "baml"): void => {
    onChange({ ToolPlanningMode });
  };

  const updateVisionInput = (next: ModelVisionInputDraft | undefined): void => {
    onChange({
      Capabilities: withVisionInput(model.Capabilities, next),
    });
  };

  const updateStaticVisionFormats = (formats: string[]): void => {
    const next: ModelVisionInputDraft = { ...visionInput };
    const staticFormats = formats.length > 0 ? formats : undefined;
    if (staticFormats) next.SupportedMimeTypes = staticFormats;
    else delete next.SupportedMimeTypes;
    const effectiveStaticFormats = staticFormats ?? PortableStaticVisionFormats;
    const animatedFormats = next.SupportedAnimatedMimeTypes?.filter((mime) => effectiveStaticFormats.includes(mime));
    if (animatedFormats && animatedFormats.length > 0) next.SupportedAnimatedMimeTypes = animatedFormats;
    else delete next.SupportedAnimatedMimeTypes;
    updateVisionInput(next);
  };

  const updateAnimatedVisionFormats = (formats: string[]): void => {
    const next: ModelVisionInputDraft = { ...visionInput };
    if (formats.length === 0) {
      delete next.SupportedAnimatedMimeTypes;
    } else {
      next.SupportedAnimatedMimeTypes = formats;
      next.SupportedMimeTypes = [...new Set([...(next.SupportedMimeTypes ?? PortableStaticVisionFormats), ...formats])];
    }
    updateVisionInput(next);
  };

  const removeButton = (
    <Button
      size="sm"
      variant="ghost"
      disabled={disabled || !isSaved}
      className="gap-1.5 text-status-danger hover:text-status-danger"
      onClick={() => {
        if (modelIndex !== null) onRemove(modelIndex);
      }}
    >
      <AppIcon icon="trash" size={14} />
      {isSaved ? frontendMessage("config.model.remove") : frontendMessage("config.model.unsaved")}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("config.model.optionsTitle")}
        description={model.Model}
        motionPreset="focus"
        className="h-[min(800px,calc(100dvh_-_32px))] w-[min(720px,calc(100vw_-_24px))] max-w-none"
        bodyClassName="flex min-h-0 flex-col"
        footer={
          <>
            {errorMessage ? <InlineError className="mb-2">{errorMessage}</InlineError> : null}
            <div className="flex items-center justify-between gap-3">
              {removeButton}
              <div className="flex items-center gap-2">
                {discardAction ? (
                  <Button size="sm" variant="outline" onClick={discardAction.onDiscard}>
                    {discardAction.label}
                  </Button>
                ) : null}
                <Button size="sm" disabled={disabled} onClick={onCommit}>
                  {isSaved ? commitLabels.existing : commitLabels.new}
                </Button>
              </div>
            </div>
          </>
        }
      >
        <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
          <div className="space-y-7 px-6 pb-5 pt-1" onBlurCapture={onCommitDraft}>
            <section>
              <MenuRow
                icon={<AppIcon icon="tools" size={16} />}
                label={frontendMessage("config.model.toolPlanningTitle")}
                description={frontendMessage("config.model.toolPlanningDescription")}
              >
                <ToolPlanningModeControl
                  value={toolPlanningMode}
                  disabled={disabled}
                  onChange={updateToolPlanningMode}
                />
              </MenuRow>
            </section>

            <section>
              <SectionLabel
                icon={<AppIcon icon="cpu-chip" size={16} />}
                title={frontendMessage("config.model.capabilitiesTitle")}
                description={frontendMessage("config.model.capabilitiesDescription")}
              />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-x-6 border-y border-line-subtle py-1">
                {ModelCapabilityIconItems.map((item) => (
                  <CapabilityToggle
                    key={item.key}
                    label={item.label}
                    icon={<AppIcon icon={item.icon} size={16} />}
                    iconClassName={item.className}
                    enabled={capabilities[item.key]}
                    disabled={disabled}
                    onChange={(enabled) => updateCapability(item.key, enabled)}
                  />
                ))}
              </div>
            </section>

            {capabilities.ImageOutput ? (
              <section>
                <SectionLabel
                  icon={<AppIcon icon="image" size={16} />}
                  title={frontendModelConfigMessage("config.model.imageGeneration.title")}
                  description={frontendModelConfigMessage("config.model.imageGeneration.hint")}
                />
                <SettingsTable>
                  <MenuRow label={frontendModelConfigMessage("config.model.imageGeneration.protocol")}>
                    <MenuSelect
                      value={model.ImageGeneration?.Api ?? ""}
                      placeholder={frontendModelConfigMessage("config.model.imageGeneration.unset")}
                      ariaLabel={frontendModelConfigMessage("config.model.imageGeneration.protocol")}
                      disabled={disabled}
                      options={[
                        { value: "", label: frontendModelConfigMessage("config.model.imageGeneration.unset") },
                        ...AgentImageGenerationApis.map((value) => ({ value, label: value })),
                      ]}
                      onChange={(value) => {
                        const Api = AgentImageGenerationApis.find((api) => api === value);
                        onChange({
                          ImageGeneration: Api
                            ? { ...model.ImageGeneration, Api, ...(Api !== "openai-images" ? { Mask: false } : {}) }
                            : undefined,
                        });
                      }}
                    />
                  </MenuRow>
                  {model.ImageGeneration ? (
                    <>
                      <ToggleRow
                        label={frontendModelConfigMessage("config.model.imageGeneration.editing")}
                        enabled={model.ImageGeneration.Editing}
                        disabled={disabled}
                        onChange={(Editing) =>
                          onChange({
                            ImageGeneration: {
                              ...model.ImageGeneration!,
                              Editing,
                              ...(!Editing ? { Mask: false } : {}),
                            },
                          })
                        }
                      />
                      {model.ImageGeneration.Api === "openai-images" && model.ImageGeneration.Editing ? (
                        <ToggleRow
                          label={frontendModelConfigMessage("config.model.imageGeneration.mask")}
                          enabled={model.ImageGeneration.Mask}
                          disabled={disabled}
                          onChange={(Mask) => onChange({ ImageGeneration: { ...model.ImageGeneration!, Mask } })}
                        />
                      ) : null}
                    </>
                  ) : null}
                </SettingsTable>
              </section>
            ) : null}

            <ModelThinkingControls
              model={model}
              disabled={disabled}
              reasoningEnabled={reasoningEnabled}
              onChange={onChange}
            />

            <section>
              <SectionLabel
                icon={<AppIcon icon="image" size={16} />}
                title={frontendModelConfigMessage("config.model.visionInputTitle")}
                description={frontendModelConfigMessage("config.model.visionInputDescription")}
              />
              <SettingsTable>
                <ModelVisionFormatEditor
                  label={frontendModelConfigMessage("config.model.visionInputMimeTypes")}
                  description={frontendModelConfigMessage("config.model.visionInputMimeTypesHint")}
                  emptyHint={frontendModelConfigMessage("config.model.visionInputMimeTypesEmpty")}
                  values={visionInput?.SupportedMimeTypes}
                  baseline={PortableStaticVisionFormats}
                  presets={StaticVisionFormatPresets}
                  disabled={disabled}
                  onChange={updateStaticVisionFormats}
                />
                <ModelVisionFormatEditor
                  label={frontendModelConfigMessage("config.model.visionInputAnimatedMimeTypes")}
                  description={frontendModelConfigMessage("config.model.visionInputAnimatedMimeTypesHint")}
                  emptyHint={frontendModelConfigMessage("config.model.visionInputAnimatedMimeTypesEmpty")}
                  values={visionInput?.SupportedAnimatedMimeTypes}
                  baseline={[]}
                  presets={AnimatedVisionFormatPresets}
                  disabled={disabled}
                  onChange={updateAnimatedVisionFormats}
                />
              </SettingsTable>
            </section>

            <section>
              <SectionLabel
                icon={<AppIcon icon="tag" size={16} />}
                title={frontendMessage("config.model.identityTitle")}
                description={frontendMessage("config.model.identityDescription")}
              />
              <SettingsTable>
                <TextRow
                  label={frontendMessage("config.model.modelId")}
                  description={frontendMessage("config.model.modelIdHint")}
                  value={model.Model}
                  disabled
                />
                <MenuRow
                  label={frontendMessage("config.model.endpointProtocol")}
                  description={frontendMessage("config.model.endpointProtocolHint")}
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
                <MenuRow label={frontendMessage("config.model.icon")}>
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
              <ModelsDevMetadataSummary metadata={catalogMetadata} />
            </section>

            <section>
              <SectionLabel
                icon={<AppIcon icon="pricing" size={16} />}
                title={frontendModelConfigMessage("config.model.pricingTitle")}
                description={frontendModelConfigMessage("config.model.pricingDescription")}
              />
              <SettingsTable>
                {(["input", "output", "cacheRead", "cacheWrite"] as const).map((kind) => (
                  <NumberRow
                    key={kind}
                    label={frontendModelConfigMessage(`config.model.price.${kind}`)}
                    value={model.Pricing?.[kind]}
                    placeholder={
                      catalogMetadata?.pricing?.[kind] === undefined
                        ? frontendModelConfigMessage("config.model.price.unknown")
                        : frontendModelConfigMessage("config.model.price.reference", {
                            price: String(catalogMetadata.pricing[kind]),
                          })
                    }
                    min={0}
                    step={0.01}
                    disabled={disabled}
                    onChange={(value) => {
                      const pricing = { ...model.Pricing };
                      if (value === undefined) delete pricing[kind];
                      else pricing[kind] = value;
                      onChange({ Pricing: Object.keys(pricing).length > 0 ? pricing : undefined });
                    }}
                  />
                ))}
              </SettingsTable>
            </section>

            <section>
              <SectionLabel
                icon={<AppIcon icon="context-window" size={16} />}
                title={frontendMessage("config.model.parametersTitle")}
                description={frontendMessage("config.model.parametersDescription")}
              />
              <SettingsTable>
                <ModelContextWindowControl
                  value={contextWindowTokens}
                  reference={catalogMetadata?.contextLimit}
                  disabled={disabled}
                  onChange={(ContextWindowTokens) => onChange({ ContextWindowTokens })}
                />
                <NumberRow
                  label={frontendMessage("config.model.maxModelOutput")}
                  description={frontendMessage("config.model.maxModelOutputHint")}
                  value={maxModelOutputTokens}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  onChange={(MaxModelOutputTokens) => onChange({ MaxModelOutputTokens })}
                />
              </SettingsTable>
            </section>

            <section>
              <SectionLabel
                icon={<AppIcon icon="gauge" size={16} />}
                title={frontendMessage("config.model.runtimeParameters")}
                description={frontendMessage("config.model.runtimeParametersDescription")}
              />
              <SettingsTable>
                <NumberRow
                  label={frontendMessage("config.model.temperature")}
                  description={frontendMessage("config.model.temperatureHint")}
                  value={temperature}
                  min={0}
                  max={2}
                  step={0.1}
                  disabled={disabled}
                  onChange={(Temperature) => onChange({ Temperature })}
                />
                <NumberRow
                  label={frontendMessage("config.model.maxOutput")}
                  description={frontendMessage("config.model.maxOutputHint")}
                  value={maxOutputTokens}
                  min={-1}
                  step={1}
                  disabled={disabled}
                  onChange={(MaxOutputTokens) => onChange({ MaxOutputTokens })}
                />
                <ToggleRow
                  label={frontendMessage("config.model.streaming")}
                  description={frontendMessage("config.model.streamingHint")}
                  enabled={streamEnabled}
                  disabled={disabled}
                  onChange={(Stream) => onChange({ Stream })}
                />
                <NumberRow
                  label={frontendMessage("config.model.requestTimeout")}
                  description={frontendMessage("config.model.requestTimeoutHint")}
                  value={timeoutSeconds}
                  durationUnit="seconds"
                  min={1}
                  step={1}
                  disabled={disabled}
                  onChange={(TimeoutSeconds) => onChange({ TimeoutSeconds })}
                />
                <NumberRow
                  label={frontendMessage("config.model.firstTokenTimeout")}
                  description={frontendMessage("config.model.firstTokenTimeoutHint")}
                  value={firstTokenTimeoutSeconds}
                  durationUnit="seconds"
                  min={-1}
                  step={1}
                  disabled={disabled}
                  onChange={(FirstTokenTimeoutSeconds) => onChange({ FirstTokenTimeoutSeconds })}
                />
              </SettingsTable>

              <button
                type="button"
                className="mt-2 flex w-full items-center justify-between gap-3 rounded-md border border-ink-200/65 bg-paper-100/65 px-3 py-2 text-left text-[12px] text-ink-700 transition hover:bg-ink-900/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
                aria-expanded={advancedRuntimeOpen}
                aria-controls={runtimeAdvancedId}
                onClick={() => setAdvancedRuntimeOpen((current) => !current)}
              >
                <span className="inline-flex min-w-0 items-center gap-2 font-medium">
                  <AppIcon icon="sliders" size={14} className="text-ink-500" />
                  <span className="truncate">{frontendMessage("config.model.runtimeAdvanced")}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-2">
                  {advancedRuntimeOverrideCount > 0 ? (
                    <span className="rounded-sm bg-ink-900/[0.06] px-1.5 py-0.5 text-[10.5px] text-ink-600">
                      {frontendMessage("config.model.runtimeAdvancedCount", {
                        count: advancedRuntimeOverrideCount,
                      })}
                    </span>
                  ) : null}
                  <AppIcon
                    icon="chevron-down"
                    size={14}
                    className={cn("text-ink-500 transition-transform", advancedRuntimeOpen && "rotate-180")}
                  />
                </span>
              </button>
              <MotionDisclosure id={runtimeAdvancedId} open={advancedRuntimeOpen} className="mt-2">
                <SettingsTable>
                  <NumberRow
                    label={frontendMessage("config.model.maxRequestTime")}
                    description={frontendMessage("config.model.maxRequestTimeHint")}
                    value={maxRequestSeconds}
                    durationUnit="seconds"
                    min={-1}
                    step={1}
                    disabled={disabled}
                    onChange={(MaxRequestSeconds) => onChange({ MaxRequestSeconds })}
                  />
                  <NumberRow
                    label={frontendMessage("config.model.maxResponseBytes")}
                    description={frontendMessage("config.model.maxResponseBytesHint")}
                    value={maxResponseBytes}
                    min={1}
                    step={1048576}
                    disabled={disabled}
                    onChange={(MaxResponseBytes) => onChange({ MaxResponseBytes })}
                  />
                  <NumberRow
                    label={frontendMessage("config.model.maxSseEventBytes")}
                    description={frontendMessage("config.model.maxSseEventBytesHint")}
                    value={maxSseEventBytes}
                    min={1}
                    step={1048576}
                    disabled={disabled}
                    onChange={(MaxSseEventBytes) => onChange({ MaxSseEventBytes })}
                  />
                  <NumberRow
                    label={frontendMessage("config.model.maxSseEvents")}
                    description={frontendMessage("config.model.maxSseEventsHint")}
                    value={maxSseEvents}
                    min={1}
                    step={1}
                    disabled={disabled}
                    onChange={(MaxSseEvents) => onChange({ MaxSseEvents })}
                  />
                  <NumberRow
                    label={frontendMessage("config.model.networkRetries")}
                    description={frontendMessage("config.model.networkRetriesHint")}
                    value={maxNetworkRetries}
                    min={0}
                    step={1}
                    disabled={disabled}
                    onChange={(MaxNetworkRetries) => onChange({ MaxNetworkRetries })}
                  />
                  <NumberRow
                    label={frontendMessage("config.model.retryBaseDelay")}
                    description={frontendMessage("config.model.retryBaseDelayHint")}
                    value={retryBaseDelaySeconds}
                    durationUnit="seconds"
                    min={0.001}
                    step={0.05}
                    disabled={disabled}
                    onChange={(RetryBaseDelaySeconds) => onChange({ RetryBaseDelaySeconds })}
                  />
                  <NumberRow
                    label={frontendMessage("config.model.retryMaxDelay")}
                    description={frontendMessage("config.model.retryMaxDelayHint")}
                    value={retryMaxDelaySeconds}
                    durationUnit="seconds"
                    min={0.001}
                    step={1}
                    disabled={disabled}
                    onChange={(RetryMaxDelaySeconds) => onChange({ RetryMaxDelaySeconds })}
                  />
                  <NumberRow
                    label={frontendMessage("config.model.retryAfterMaxDelay")}
                    description={frontendMessage("config.model.retryAfterMaxDelayHint")}
                    value={retryAfterMaxDelaySeconds}
                    durationUnit="seconds"
                    min={0.001}
                    step={1}
                    disabled={disabled}
                    onChange={(RetryAfterMaxDelaySeconds) => onChange({ RetryAfterMaxDelaySeconds })}
                  />
                </SettingsTable>
              </MotionDisclosure>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function withVisionInput(
  capabilities: ModelCapabilitiesDraft | undefined,
  visionInput: ModelVisionInputDraft | undefined,
): ModelCapabilitiesDraft {
  const { VisionInput: _previousVisionInput, ...remaining } = capabilities ?? {};
  const hasVisionInput =
    visionInput !== undefined &&
    (visionInput.SupportedMimeTypes?.length ||
      visionInput.SupportedAnimatedMimeTypes?.length ||
      visionInput.MaxBytes !== undefined ||
      visionInput.MaxPixels !== undefined);
  return {
    ...remaining,
    ...(hasVisionInput && visionInput ? { VisionInput: visionInput } : {}),
  };
}
