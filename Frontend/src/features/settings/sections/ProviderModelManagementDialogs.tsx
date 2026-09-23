import { useEffect, useRef, useState, type ReactNode } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { cn } from "../../../lib/util";
import { FluidHoverHighlight, useFluidHover, useMotionLevel } from "../../../shared/motion";
import {
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  AppIcon,
  FormLabel,
  Input,
  ScrollArea,
  Skeleton,
  Spinner,
  StateView,
  Tooltip,
} from "../../../shared/ui";
import {
  defaultModelCapabilities,
  groupProviderModelRows,
  modelConfigId,
  readProviderModelOwnedBy,
} from "../../chat/modelConfigData";
import { ModelCapabilityIconItems } from "../../chat/ModelCapabilityControls";
import { ModelsDevMetadataSummary, SearchInput } from "../../chat/ModelConfigPrimitives";
import { inferModelProviderIcon, ModelProviderIcon } from "../../chat/ModelProviderIcon";
import type { ModelCapabilitiesDraft, ModelProviderDraft, ProviderModelInfo } from "../../chat/modelConfigTypes";

export function ProviderModelCatalogDialog({
  configuredModels,
  disabled,
  error,
  groups,
  loading,
  onAddModel,
  onOpenChange,
  onRetryFetch,
  onSearch,
  open,
  pendingModelIds,
  providerId,
  rows,
  search,
}: {
  configuredModels: readonly ModelProviderDraft[];
  disabled: boolean;
  error: string | null;
  groups: ReturnType<typeof groupProviderModelRows>;
  loading: boolean;
  onAddModel: (model: ProviderModelInfo) => void;
  onOpenChange: (open: boolean) => void;
  onRetryFetch?: () => void;
  onSearch: (value: string) => void;
  open: boolean;
  pendingModelIds: ReadonlyMap<string, string>;
  providerId: string;
  rows: ProviderModelInfo[];
  search: string;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("settings.modelManagement.fetchTitle")}
        description={frontendMessage("settings.modelManagement.fetchDescription", { provider: providerId })}
        className="h-[min(760px,calc(100dvh_-_32px))] w-[min(780px,calc(100vw_-_32px))] max-w-none"
        bodyClassName="flex min-h-0 flex-1 flex-col p-0"
      >
        <CatalogModelDialogContent
          rows={rows}
          groups={groups}
          configuredModels={configuredModels}
          pendingModelIds={pendingModelIds}
          providerId={providerId}
          search={search}
          loading={loading}
          error={error}
          disabled={disabled}
          onSearch={onSearch}
          onAddModel={onAddModel}
          onRetryFetch={onRetryFetch}
        />
      </DialogContent>
    </Dialog>
  );
}

export type ManualModelAddOptions = {
  modelId: string;
  modelName: string;
  capabilities: ModelCapabilitiesDraft;
  contextWindowTokens?: number;
  maxModelOutputTokens?: number;
  maxOutputTokens?: number;
};

const manualModelTypeKeys = ["Chat", "Vision", "Embedding", "Rerank"] as const;
const manualCapabilityKeys = ["Reasoning", "ToolCalling"] as const;
const contextWindowPresets = [
  { label: "128K", value: "128000" },
  { label: "200K", value: "200000" },
  { label: "256K", value: "256000" },
  { label: "400K", value: "400000" },
  { label: "512K", value: "512000" },
  { label: "1M", value: "1000000" },
] as const;
const outputTokenPresets = [
  { label: "16K", value: "16000" },
  { label: "32K", value: "32000" },
  { label: "64K", value: "64000" },
  { label: "128K", value: "128000" },
  { label: "256K", value: "256000" },
] as const;

export function ProviderModelManualAddDialog({
  disabled,
  modelTemplate,
  onAdd,
  onOpenChange,
  open,
  providerId,
}: {
  disabled: boolean;
  modelTemplate: Record<string, unknown>;
  onAdd: (options: ManualModelAddOptions) => boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  providerId: string;
}): JSX.Element {
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [capabilities, setCapabilities] = useState(() => defaultModelCapabilities(modelTemplate, "", providerId));
  const [contextWindowTokens, setContextWindowTokens] = useState("");
  const [maxModelOutputTokens, setMaxModelOutputTokens] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");

  useEffect(() => {
    if (!open) return;
    setModelId("");
    setModelName("");
    setAdvancedOpen(false);
    setCapabilities(defaultModelCapabilities(modelTemplate, "", providerId));
    setContextWindowTokens("");
    setMaxModelOutputTokens("");
    setMaxOutputTokens("");
  }, [modelTemplate, open, providerId]);

  const submit = (): void => {
    const nextModelId = modelId.trim();
    if (disabled || !nextModelId) return;
    if (
      onAdd({
        modelId: nextModelId,
        modelName: modelName.trim() || nextModelId,
        capabilities,
        contextWindowTokens: readOptionalNumber(contextWindowTokens),
        maxModelOutputTokens: readOptionalNumber(maxModelOutputTokens),
        maxOutputTokens: readOptionalNumber(maxOutputTokens),
      })
    ) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("settings.modelManagement.addModelTitle")}
        className={cn(
          "w-[min(560px,calc(100vw_-_24px))] max-w-none",
          advancedOpen ? "h-[min(760px,calc(100dvh_-_24px))]" : "min-h-[320px]",
        )}
        bodyClassName="flex min-h-0 flex-1 flex-col px-4 pb-2 pt-1"
        footerClassName="border-t border-line-subtle/70 px-4 pb-4 pt-3"
        footer={
          <DialogActions className="gap-2">
            <DialogActionButton className="min-w-0 px-3" onClick={() => onOpenChange(false)}>
              {frontendMessage("settings.action.cancel")}
            </DialogActionButton>
            <DialogActionButton
              variant="primary"
              className="min-w-0 px-3"
              disabled={disabled || !modelId.trim()}
              onClick={submit}
            >
              {frontendMessage("settings.modelManagement.addModel")}
            </DialogActionButton>
          </DialogActions>
        }
      >
        <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full pr-1">
          <div className="space-y-3 px-1 pb-1">
            <div className="grid gap-2.5 sm:grid-cols-[100px_minmax(0,1fr)] sm:items-center">
              <FormLabel required>{frontendMessage("settings.modelManagement.modelIdLabel")}</FormLabel>
              <Input
                autoFocus
                aria-label={frontendMessage("settings.modelManagement.modelIdLabel")}
                className="h-8 rounded-md px-2.5 text-[12px]"
                value={modelId}
                placeholder={frontendMessage("settings.modelManagement.modelIdPlaceholder")}
                onChange={(event) => setModelId(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
              />
              <FormLabel>{frontendMessage("config.model.modelName")}</FormLabel>
              <Input
                aria-label={frontendMessage("config.model.modelName")}
                className="h-8 rounded-md px-2.5 text-[12px]"
                value={modelName}
                placeholder={frontendMessage("config.model.modelNamePlaceholder")}
                onChange={(event) => setModelName(event.currentTarget.value)}
              />
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[12px] text-content-secondary transition hover:text-content-primary disabled:pointer-events-none disabled:opacity-50"
              disabled={disabled}
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((value) => !value)}
            >
              {frontendMessage("settings.provider.moreSettings")}
              <AppIcon
                icon="chevron-down"
                size={14}
                className={cn("transition-transform", advancedOpen && "rotate-180")}
              />
            </button>
            {advancedOpen ? (
              <div className="space-y-3">
                <section className="rounded-lg border border-line-subtle bg-surface-subtle p-3">
                  <ManualOptionGroup
                    label={frontendMessage("config.model.modelType")}
                    keys={manualModelTypeKeys}
                    capabilities={capabilities}
                    disabled={disabled}
                    onToggle={(key) => setCapabilities((value) => ({ ...value, [key]: !value[key] }))}
                  />
                  <ManualOptionGroup
                    className="mt-3"
                    label={frontendMessage("config.model.capabilitiesTitle")}
                    keys={manualCapabilityKeys}
                    capabilities={capabilities}
                    disabled={disabled}
                    onToggle={(key) => setCapabilities((value) => ({ ...value, [key]: !value[key] }))}
                  />
                </section>
                <section className="rounded-lg border border-line-subtle bg-surface-subtle p-3">
                  <ManualTokenField
                    label={frontendMessage("config.model.contextWindow")}
                    value={contextWindowTokens}
                    placeholder={frontendMessage("config.model.contextWindowPlaceholder")}
                    presets={contextWindowPresets}
                    disabled={disabled}
                    onChange={setContextWindowTokens}
                  />
                  <ManualTokenField
                    className="mt-3"
                    label={frontendMessage("config.model.maxModelOutput")}
                    value={maxModelOutputTokens}
                    placeholder={frontendMessage("config.model.maxModelOutputPlaceholder")}
                    presets={outputTokenPresets}
                    disabled={disabled}
                    onChange={setMaxModelOutputTokens}
                  />
                  <ManualTokenField
                    className="mt-3"
                    label={frontendMessage("config.model.maxOutput")}
                    value={maxOutputTokens}
                    placeholder={frontendMessage("config.model.maxOutputPlaceholder")}
                    presets={outputTokenPresets}
                    disabled={disabled}
                    onChange={setMaxOutputTokens}
                  />
                </section>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ManualOptionGroup({
  className,
  label,
  keys,
  capabilities,
  disabled,
  onToggle,
}: {
  className?: string;
  label: string;
  keys: readonly (keyof ModelCapabilitiesDraft)[];
  capabilities: ModelCapabilitiesDraft;
  disabled: boolean;
  onToggle: (key: keyof ModelCapabilitiesDraft) => void;
}): JSX.Element {
  return (
    <div className={className}>
      <div className="text-[12px] text-content-secondary">{label}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {keys.map((key) => {
          const item = ModelCapabilityIconItems.find((candidate) => candidate.key === key);
          if (!item) return null;
          return (
            <ManualOptionChip
              key={key}
              icon={item.icon}
              label={item.label}
              selected={Boolean(capabilities[key])}
              disabled={disabled}
              onClick={() => onToggle(key)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ManualOptionChip({
  icon,
  label,
  selected,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition",
        selected
          ? "border-accent-border bg-accent-surface text-accent-content"
          : "border-line bg-surface-panel text-content-secondary hover:border-line-strong hover:bg-surface-hover",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function ManualTokenField({
  className,
  label,
  value,
  placeholder,
  presets,
  disabled,
  onChange,
}: {
  className?: string;
  label: string;
  value: string;
  placeholder: string;
  presets: readonly { label: string; value: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className={className}>
      <div className="text-[12px] text-content-secondary">{label}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            disabled={disabled}
            className={cn(
              "h-7 rounded-full border px-2.5 text-[11px] transition",
              value === preset.value
                ? "border-accent-border bg-accent-surface text-accent-content"
                : "border-line bg-surface-panel text-content-secondary hover:border-line-strong hover:bg-surface-hover",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
            onClick={() => onChange(preset.value)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <Input
        type="number"
        aria-label={label}
        min={0}
        step={1}
        className="mt-2 h-8 rounded-md px-2.5 text-[12px]"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

function readOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

export function ProviderModelGroupUnsupportedDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("settings.modelManagement.unsupportedTitle")}
        className="w-[min(460px,calc(100vw-32px))]"
      >
        <div className="p-4 text-[13px] text-ink-700">
          <p>{frontendMessage("settings.modelManagement.unsupportedDescription")}</p>
          <p className="mt-2">{frontendMessage("settings.modelManagement.unsupportedHint")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CatalogModelDialogContent({
  rows,
  groups,
  configuredModels,
  pendingModelIds,
  providerId,
  search,
  loading,
  error,
  disabled,
  onSearch,
  onAddModel,
  onRetryFetch,
}: {
  rows: ProviderModelInfo[];
  groups: ReturnType<typeof groupProviderModelRows>;
  configuredModels: readonly ModelProviderDraft[];
  pendingModelIds: ReadonlyMap<string, string>;
  providerId: string;
  search: string;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onSearch: (value: string) => void;
  onAddModel: (model: ProviderModelInfo) => void;
  onRetryFetch?: () => void;
}): JSX.Element {
  const configuredIds = new Set(
    configuredModels.filter((model) => model.ProviderId === providerId).map((model) => model.Model),
  );
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const { disableMotion } = useMotionLevel();
  const catalogListRef = useRef<HTMLDivElement>(null);
  const catalogHover = useFluidHover(catalogListRef, { axis: "y", gapClick: false });
  let rowIndex = 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-8 pb-4 pt-1">
        <div className="flex items-center gap-3">
          <SearchInput
            value={search}
            disabled={disabled || loading}
            placeholder={frontendMessage("settings.modelManagement.search")}
            className="h-9 flex-1 rounded-lg"
            onChange={onSearch}
          />
          <span className="shrink-0 tabular-nums text-[11.5px] text-ink-500">
            {frontendMessage("config.model.count", { count: rows.length })}
          </span>
        </div>
        {groups.length > 1 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {groups.map((group) => (
              <Tooltip key={group.id} content={`${group.label}: ${group.rows.length}`} side="top">
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-ink-200/80 bg-paper-50 px-2.5",
                    "text-[11px] font-medium text-ink-650 transition-colors duration-150",
                    "hover:border-accent-border-strong hover:text-accent-content-hover",
                  )}
                  onClick={() =>
                    groupRefs.current.get(group.id)?.scrollIntoView({ block: "start", behavior: "smooth" })
                  }
                >
                  <ModelProviderIcon icon={group.icon} size={13} className="rounded-sm" />
                  <span className="max-w-28 truncate">{group.label}</span>
                  <span className="tabular-nums text-[10px] text-ink-400">{group.rows.length}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {loading ? (
          <CatalogLoadingSkeleton />
        ) : error ? (
          <StateView
            status="error"
            className="min-h-[320px]"
            description={frontendMessage("settings.modelManagement.fetchFailed", { error })}
            onRetry={onRetryFetch}
          />
        ) : rows.length > 0 ? (
          <div ref={catalogListRef} className="relative px-5 pb-6 pt-4" {...catalogHover.handlers}>
            <FluidHoverHighlight
              hover={catalogHover}
              hidden={disableMotion}
              surfaceClassName="bg-ink-900/[0.03]"
              className="rounded-lg"
            />
            {groups.map((group) => (
              <section key={group.id}>
                <div
                  ref={(element) => {
                    if (element) {
                      groupRefs.current.set(group.id, element);
                    } else {
                      groupRefs.current.delete(group.id);
                    }
                  }}
                  className="sticky -top-px z-[1] -mx-5 flex scroll-mt-0 items-center gap-2 bg-surface-panel px-8 py-2.5"
                >
                  <ModelProviderIcon icon={group.icon} size={14} className="rounded-sm" />
                  <span className="truncate text-[11px] font-semibold tracking-wide text-ink-600">{group.label}</span>
                  <span className="h-px min-w-4 flex-1 bg-ink-200/70" />
                  <span className="tabular-nums text-[10.5px] text-ink-400">{group.rows.length}</span>
                </div>
                <div className="space-y-px pb-4 pt-1">
                  {group.rows.map((row) => {
                    const index = rowIndex;
                    rowIndex += 1;
                    return (
                      <CatalogModelRow
                        key={row.id}
                        itemRef={catalogHover.getItemRef(index)}
                        fluidHoverEnabled={!disableMotion}
                        row={row}
                        configured={configuredIds.has(row.id)}
                        pending={pendingModelIds.has(modelConfigId(providerId, row.id))}
                        disabled={disabled}
                        onAddModel={onAddModel}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <StateView
            status="empty"
            className="min-h-[320px]"
            description={frontendMessage("settings.modelManagement.noMatches")}
          />
        )}
      </ScrollArea>
    </div>
  );
}

function CatalogModelRow({
  itemRef,
  fluidHoverEnabled,
  row,
  configured,
  pending,
  disabled,
  onAddModel,
}: {
  itemRef: (element: HTMLElement | null) => void;
  fluidHoverEnabled: boolean;
  row: ProviderModelInfo;
  configured: boolean;
  pending: boolean;
  disabled: boolean;
  onAddModel: (model: ProviderModelInfo) => void;
}): JSX.Element {
  return (
    <div
      ref={itemRef}
      className={cn(
        "relative z-10 grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2",
        fluidHoverEnabled
          ? "transition-colors duration-150 hover:bg-transparent"
          : "transition-colors duration-150 hover:bg-ink-900/[0.03]",
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center">
        <ModelProviderIcon
          icon={inferModelProviderIcon(readProviderModelOwnedBy(row), false) ?? inferModelProviderIcon(row.id, false)}
          size={18}
          className="rounded"
        />
      </span>
      <span className="min-w-0">
        <Tooltip content={row.id} side="top">
          <span className="block truncate font-mono text-[12.5px] leading-5 text-ink-850">{row.id}</span>
        </Tooltip>
        <span className="mt-0.5 block truncate text-[11px] text-ink-500">
          {readProviderModelOwnedBy(row) || frontendMessage("settings.modelManagement.providerModel")}
        </span>
        <ModelsDevMetadataSummary metadata={row.modelsDev} />
      </span>
      {configured ? (
        <span className="inline-flex items-center gap-1 pr-1 text-[11px] font-medium text-moss-600">
          <AppIcon icon="checkmark" size={14} />
          {frontendMessage("settings.modelManagement.added")}
        </span>
      ) : pending ? (
        <span className="inline-flex items-center gap-1.5 pr-1 text-[11px] font-medium text-ink-600">
          <Spinner size="xs" className="text-accent-content" />
          {frontendMessage("settings.modelManagement.adding")}
        </span>
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-label={frontendMessage("settings.modelManagement.addModelAria", { model: row.id })}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-ink-200 bg-paper-50 pl-2 pr-2.5",
            "text-[11.5px] font-medium text-ink-650 transition-colors duration-150",
            "hover:border-accent-border-strong hover:bg-accent-surface-hover hover:text-accent-content-hover",
            "disabled:pointer-events-none disabled:opacity-45",
          )}
          onClick={() => onAddModel(row)}
        >
          <AppIcon icon="plus" size={14} />
          {frontendMessage("settings.action.add")}
        </button>
      )}
    </div>
  );
}

const skeletonRowWidths = ["w-48", "w-36", "w-56", "w-40", "w-52", "w-32"] as const;

function CatalogLoadingSkeleton(): JSX.Element {
  return (
    <div role="status" aria-busy="true" className="px-5 pb-6 pt-1.5">
      <span className="sr-only">{frontendMessage("settings.modelManagement.fetching")}</span>
      <div aria-hidden="true">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <Skeleton className="h-3.5 w-3.5 rounded-sm" />
          <Skeleton className="h-3 w-16" />
          <span className="h-px flex-1 bg-ink-200/70" />
        </div>
        {skeletonRowWidths.map((width, index) => (
          <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <span className="min-w-0">
              <Skeleton className={cn("h-3 max-w-[60%]", width)} />
              <Skeleton className="mt-2 h-2.5 w-24" />
            </span>
            <Skeleton className="h-7 w-16 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
