import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { BrainCircuit, Layers3, Server, SlidersHorizontal } from "lucide-react";
import { cn } from "../../lib/util";
import { MenuSelect, ScrollArea, Switch } from "../../shared/ui";
import {
  JsonConfigSettingsView,
  writeJsonConfigFieldValue,
  type JsonConfigObject,
} from "../../shared/config/JsonConfigForm";
import type { ConfigFormSectionData } from "../../api/eventTypes";
import { ModelProviderIcon, inferModelProviderIcon } from "./ModelProviderIcon";

interface ProviderEndpointDraft {
  Id: string;
  Icon?: string;
  Enabled?: boolean;
}

interface ModelProviderDraft {
  Id: string;
  ProviderId: string;
  Model: string;
  Icon?: string;
  Capabilities?: {
    Embedding?: boolean;
    Rerank?: boolean;
  };
}

type VectorCapability = "Embedding" | "Rerank";

export function VectorModelConfigView({
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
  const providers = readProviders(value.ModelProviderEndpoints);
  const models = readModels(value.ModelProviders);
  const nonVectorSection = section
    ? {
        ...section,
        fields: section.fields.filter((field) => field.path[0] !== "VectorModels"),
      }
    : undefined;

  const content = (
    <div
      className={cn("mx-auto w-full max-w-[1180px] px-4 py-5 sm:px-6 sm:py-7", layoutMode === "panel" && "min-h-full")}
    >
      <div className="space-y-7">
        <section>
          <SectionTitle
            icon={<BrainCircuit className="h-4 w-4" />}
            title={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.72.19")}
            description={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.73.25")}
          />
          <div className="grid gap-3 lg:grid-cols-2">
            <VectorModelCard
              title={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.77.21")}
              description={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.78.27")}
              capability="Embedding"
              providers={providers}
              models={models}
              value={readVectorConfig(value, "Embedding")}
              disabled={Boolean(disabled)}
              onChange={(patch) => onChange(writeVectorConfig(value, "Embedding", patch))}
            />
            <VectorModelCard
              title={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.87.21")}
              description={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.88.27")}
              capability="Rerank"
              providers={providers}
              models={models}
              value={readVectorConfig(value, "Rerank")}
              disabled={Boolean(disabled)}
              onChange={(patch) => onChange(writeVectorConfig(value, "Rerank", patch))}
            />
          </div>
        </section>

        {nonVectorSection && nonVectorSection.fields.length > 0 ? (
          <JsonConfigSettingsView
            layoutMode={layoutMode}
            sections={[nonVectorSection]}
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

function VectorModelCard({
  title,
  description,
  capability,
  providers,
  models,
  value,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  capability: VectorCapability;
  providers: ProviderEndpointDraft[];
  models: ModelProviderDraft[];
  value: Record<string, unknown>;
  disabled: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}): JSX.Element {
  const enabled = readBoolean(value.Enabled) ?? true;
  const providerId = readString(value.ProviderId) ?? "";
  const providerOptions = providers
    .filter((provider) => provider.Id && provider.Enabled !== false)
    .map((provider) => ({ value: provider.Id, label: provider.Id, icon: provider.Icon }));
  const modelOptions = models
    .filter((model) => model.ProviderId === providerId && model.Model && model.Capabilities?.[capability] === true)
    .map((model) => ({
      value: model.Model,
      label: model.Model,
      icon: model.Icon ?? inferModelProviderIcon(model.Model),
    }));

  return (
    <div className="overflow-hidden border border-ink-200/70 bg-paper-100">
      <div className="flex items-start justify-between gap-3 border-b border-ink-200/70 bg-[var(--theme-config-list-bg)] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink-900">{title}</div>
          <div className="mt-0.5 text-[11.5px] leading-4 text-ink-500">{description}</div>
        </div>
        <Switch
          checked={enabled}
          disabled={disabled}
          ariaLabel={title}
          onCheckedChange={(Enabled) => onChange({ Enabled })}
        />
      </div>

      <div className="divide-y divide-ink-200/70">
        <SettingLine
          icon={<Server className="h-3.5 w-3.5" />}
          label={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.177.70")}
        >
          <MenuSelect
            value={providerId}
            placeholder={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.180.25")}
            ariaLabel={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.177.70")}
            options={providerOptions}
            disabled={disabled || !enabled || providerOptions.length === 0}
            emptyState={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.384.38")}
            renderValue={(value, option) => {
              const current = providerOptions.find((entry) => entry.value === value);
              return current ? (
                <span className="inline-flex min-w-0 items-center gap-2">
                  {current.icon ? <ModelProviderIcon icon={current.icon} size={16} /> : null}
                  <span className="truncate">{current.label}</span>
                </span>
              ) : (
                <span className="truncate">{option?.label}</span>
              );
            }}
            renderOption={(option) => {
              const current = providerOptions.find((entry) => entry.value === option.value);
              return current ? (
                <span className="inline-flex min-w-0 items-center gap-2">
                  {current.icon ? <ModelProviderIcon icon={current.icon} size={16} /> : null}
                  <span className="truncate">{current.label}</span>
                </span>
              ) : (
                <span className="truncate">{option.label}</span>
              );
            }}
            onChange={(ProviderId) => onChange({ ProviderId, Model: "" })}
          />
        </SettingLine>
        <SettingLine
          icon={<BrainCircuit className="h-3.5 w-3.5" />}
          label={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.186.76")}
        >
          <MenuSelect
            value={readString(value.Model) ?? ""}
            placeholder={frontendMessage(
              providerId ? "config.vector.selectModel" : "config.vector.selectProviderFirst",
            )}
            ariaLabel={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.186.76")}
            options={modelOptions}
            disabled={disabled || !enabled || !providerId || modelOptions.length === 0}
            emptyState={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.384.38")}
            renderValue={(value, option) => {
              const current = modelOptions.find((entry) => entry.value === value);
              return current ? (
                <span className="inline-flex min-w-0 items-center gap-2">
                  {current.icon ? <ModelProviderIcon icon={current.icon} size={16} /> : null}
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
                  {current.icon ? <ModelProviderIcon icon={current.icon} size={16} /> : null}
                  <span className="truncate">{current.label}</span>
                </span>
              ) : (
                <span className="truncate">{option.label}</span>
              );
            }}
            onChange={(Model) => onChange({ Model })}
          />
          {providerId && modelOptions.length === 0 ? (
            <div className="mt-1.5 text-[11px] text-umber-600">
              {frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.196.15")}
              {capability === "Embedding" ? "向量嵌入" : "重排序"}
              {frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.196.70")}
            </div>
          ) : null}
        </SettingLine>
        {capability === "Embedding" ? (
          <>
            <NumberLine
              label={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.202.31")}
              value={readNumber(value.Dimensions)}
              disabled={disabled || !enabled}
              onChange={(Dimensions) => onChange({ Dimensions })}
            />
            <NumberLine
              label={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.203.31")}
              value={readNumber(value.BatchSize)}
              disabled={disabled || !enabled}
              onChange={(BatchSize) => onChange({ BatchSize })}
            />
            <NumberLine
              label={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.204.31")}
              value={readNumber(value.InputMaxChars)}
              disabled={disabled || !enabled}
              onChange={(InputMaxChars) => onChange({ InputMaxChars })}
            />
          </>
        ) : (
          <>
            <TextLine
              label={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.208.29")}
              value={readString(value.EndpointPath) ?? ""}
              disabled={disabled || !enabled}
              onChange={(EndpointPath) => onChange({ EndpointPath })}
            />
            <NumberLine
              label={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.209.31")}
              value={readNumber(value.CandidateLimit)}
              disabled={disabled || !enabled}
              onChange={(CandidateLimit) => onChange({ CandidateLimit })}
            />
            <NumberLine
              label="TopK"
              value={readNumber(value.TopK)}
              disabled={disabled || !enabled}
              onChange={(TopK) => onChange({ TopK })}
            />
          </>
        )}
        <NumberLine
          label={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.213.27")}
          value={readNumber(value.TimeoutSeconds)}
          disabled={disabled || !enabled}
          onChange={(TimeoutSeconds) => onChange({ TimeoutSeconds })}
        />
        <NumberLine
          label={frontendMessage("runtime.migrated.features.chat.VectorModelConfigView.214.27")}
          value={readNumber(value.MaxNetworkRetries)}
          disabled={disabled || !enabled}
          onChange={(MaxNetworkRetries) => onChange({ MaxNetworkRetries })}
        />
      </div>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  description,
}: {
  icon: JSX.Element;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <div className="mb-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 px-0.5">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink-900">
          <span className="text-ink-450">{icon}</span>
          {title}
        </h3>
        <p className="mt-0.5 text-[12px] leading-5 text-ink-500">{description}</p>
      </div>
    </div>
  );
}

function SettingLine({
  icon,
  label,
  children,
}: {
  icon: JSX.Element;
  label: string;
  children: JSX.Element | Array<JSX.Element | null>;
}): JSX.Element {
  return (
    <div className="grid min-w-0 gap-3 bg-paper-50 px-3 py-3 md:grid-cols-[150px_minmax(0,1fr)] md:items-start">
      <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-800">
        <span className="text-ink-400">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function NumberLine({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value?: number;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}): JSX.Element {
  return (
    <SettingLine icon={<SlidersHorizontal className="h-3.5 w-3.5" />} label={label}>
      <input
        type="number"
        value={value ?? ""}
        disabled={disabled}
        className={inputClassName}
        onChange={(event) => {
          const text = event.currentTarget.value.trim();
          if (!text) {
            onChange(undefined);
            return;
          }
          const parsed = Number(text);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
      />
    </SettingLine>
  );
}

function TextLine({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <SettingLine icon={<Layers3 className="h-3.5 w-3.5" />} label={label}>
      <input
        value={value}
        disabled={disabled}
        className={inputClassName}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </SettingLine>
  );
}

function readVectorConfig(value: JsonConfigObject, key: VectorCapability): Record<string, unknown> {
  const vectorModels = isRecord(value.VectorModels) ? value.VectorModels : {};
  const config = vectorModels[key];
  return isRecord(config) ? config : {};
}

function writeVectorConfig(
  value: JsonConfigObject,
  key: VectorCapability,
  patch: Record<string, unknown>,
): JsonConfigObject {
  return writeJsonConfigFieldValue(value, ["VectorModels", key], {
    ...readVectorConfig(value, key),
    ...patch,
  });
}

function readProviders(value: unknown): ProviderEndpointDraft[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((entry) => ({
        Id: readString(entry.Id) ?? "",
        Icon: readString(entry.Icon),
        Enabled: readBoolean(entry.Enabled),
      }))
    : [];
}

function readModels(value: unknown): ModelProviderDraft[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((entry) => ({
        Id: readString(entry.Id) ?? "",
        ProviderId: readString(entry.ProviderId) ?? "",
        Model: readString(entry.Model) ?? "",
        Icon: readString(entry.Icon),
        Capabilities: isRecord(entry.Capabilities)
          ? {
              Embedding: readBoolean(entry.Capabilities.Embedding),
              Rerank: readBoolean(entry.Capabilities.Rerank),
            }
          : undefined,
      }))
    : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is JsonConfigObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const inputClassName = cn(
  "h-8 w-full min-w-0 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12.5px] text-ink-800",
  "outline-none transition placeholder:text-ink-400",
  "focus:border-accent-border focus:ring-2 focus:ring-accent-focus",
  "disabled:pointer-events-none disabled:opacity-55",
);
