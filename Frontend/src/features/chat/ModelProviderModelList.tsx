import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import AdjustmentsHorizontalIcon from "@heroicons/react/24/outline/AdjustmentsHorizontalIcon";
import type { ProviderModelsFailedData, ProviderModelsSnapshotData } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { FluidHoverHighlight, MotionIconSwap, motionTimings, useFluidHover, useMotionLevel } from "../../shared/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  AppIcon,
  Button,
  IconButton,
  ScrollArea,
  Spinner,
  Tooltip,
} from "../../shared/ui";
import { inferModelProviderEndpointIcon, inferModelProviderIcon, ModelProviderIcon } from "./ModelProviderIcon";
import {
  defaultModelCapabilities,
  modelConfigId,
  providerEnabled,
  readModelCapabilities,
  readProviderModelOwnedBy,
} from "./modelConfigData";
import type {
  ModelProviderDraft,
  ProviderEndpointDraft,
  ProviderModelGroup,
  ProviderModelInfo,
} from "./modelConfigTypes";
import { CapabilityIconStrip } from "./ModelCapabilityControls";
import {
  EmptyList,
  ListHeader,
  ProviderCatalogStatus,
  SearchInput,
  iconButtonClassName,
} from "./ModelConfigPrimitives";

const EMPTY_PENDING_MODEL_IDS: ReadonlyMap<string, string> = new Map();

function pendingModelOperationLabel(kind: string): string {
  if (kind === "provider.model.delete") return frontendMessage("settings.modelManagement.removing");
  if (kind === "provider.defaultModel.set") return frontendMessage("settings.modelManagement.settingDefault");
  return frontendMessage("settings.modelManagement.adding");
}
export function ProviderModelList({
  selectedProvider,
  catalog,
  error,
  loading,
  enabled,
  canFetchModels,
  rows,
  groups,
  models,
  modelTemplate,
  defaultModelId,
  pendingModelIds = EMPTY_PENDING_MODEL_IDS,
  search,
  disabled,
  onSearch,
  onOpenModelGroups,
  onFetch,
  onAddManualModel,
  showFetchAction = true,
  compactHeader = false,
  onConfigureModel,
  onSetDefaultModel,
  onRemoveModel,
}: {
  selectedProvider: ProviderEndpointDraft | null;
  catalog?: ProviderModelsSnapshotData;
  error?: ProviderModelsFailedData & { updatedAt: string };
  loading: boolean;
  enabled: boolean;
  canFetchModels: boolean;
  rows: ProviderModelInfo[];
  groups: ProviderModelGroup[];
  models: ModelProviderDraft[];
  modelTemplate: Record<string, unknown>;
  defaultModelId: string;
  pendingModelIds?: ReadonlyMap<string, string>;
  search: string;
  disabled: boolean;
  onSearch: (value: string) => void;
  onOpenModelGroups: () => void;
  onFetch: (force?: boolean) => void;
  onAddManualModel?: () => void;
  showFetchAction?: boolean;
  compactHeader?: boolean;
  onConfigureModel: (model: ProviderModelInfo) => void;
  onSetDefaultModel?: (model: ModelProviderDraft) => void;
  onRemoveModel?: (model: ModelProviderDraft) => void;
}): JSX.Element {
  const [compactSearchOpen, setCompactSearchOpen] = useState(false);
  const compactSearchId = useId();
  const compactSearchContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollTopRef = useRef<HTMLDivElement | null>(null);
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const { disableMotion, reduceMotion } = useMotionLevel();

  useEffect(() => {
    if (!compactHeader || !compactSearchOpen) return;
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && compactSearchContainerRef.current?.contains(target)) return;
      setCompactSearchOpen(false);
      onSearch("");
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [compactHeader, compactSearchOpen, onSearch]);

  const scrollToGroup = (groupId: string | null): void => {
    const target = groupId === null ? scrollTopRef.current : groupRefs.current.get(groupId);
    target?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  };
  const modelRows = (
    <>
      <div ref={scrollTopRef} />
      <ProviderModelRows
        selectedProvider={selectedProvider}
        enabled={enabled}
        canFetchModels={canFetchModels}
        catalog={catalog}
        rows={rows}
        groups={groups}
        models={models}
        modelTemplate={modelTemplate}
        defaultModelId={defaultModelId}
        pendingModelIds={pendingModelIds}
        disabled={disabled}
        onConfigureModel={onConfigureModel}
        onSetDefaultModel={onSetDefaultModel}
        onRemoveModel={onRemoveModel}
        groupedCards={compactHeader}
        onGroupRef={(groupId, element) => {
          if (element) {
            groupRefs.current.set(groupId, element);
          } else {
            groupRefs.current.delete(groupId);
          }
        }}
      />
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {compactHeader ? (
        <div className="bg-transparent px-0 pb-3 pt-3 text-content-primary">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div ref={compactSearchContainerRef} className="flex min-w-0 items-center gap-2">
              <span className="text-[13px] font-semibold text-content-primary">
                {frontendMessage("config.model.title")}
              </span>
              <AnimatePresence initial={false}>
                {compactSearchOpen ? (
                  <motion.div
                    id={compactSearchId}
                    initial={
                      disableMotion
                        ? false
                        : reduceMotion
                          ? { opacity: 0 }
                          : { opacity: 0, transform: "translateX(-6px) scaleX(0.96)" }
                    }
                    animate={{
                      opacity: 1,
                      transform: "translateX(0) scaleX(1)",
                      transition: disableMotion ? { duration: 0 } : motionTimings.fast,
                    }}
                    exit={{
                      opacity: 0,
                      transform: reduceMotion ? undefined : "translateX(-3px) scaleX(0.98)",
                      transition: disableMotion ? { duration: 0 } : motionTimings.chatSwitch,
                    }}
                    className="origin-left w-[min(180px,36vw)] min-w-0 flex-none overflow-hidden"
                  >
                    <SearchInput
                      value={search}
                      disabled={disabled || !selectedProvider}
                      autoFocus
                      className="h-7 w-full rounded-[5px] border-line-subtle bg-surface-panel px-2"
                      onChange={onSearch}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <Tooltip
                content={frontendMessage(
                  compactSearchOpen ? "config.model.closeSearch" : "config.model.searchPlaceholder",
                )}
                side="top"
              >
                <button
                  type="button"
                  disabled={disabled || !selectedProvider}
                  className="grid h-[25px] w-[25px] place-items-center rounded-[5px] border border-transparent text-content-muted transition hover:border-line-subtle hover:bg-surface-hover hover:text-content-primary active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45"
                  onClick={() => {
                    if (compactSearchOpen) onSearch("");
                    setCompactSearchOpen((current) => !current);
                  }}
                  aria-controls={compactSearchId}
                  aria-expanded={compactSearchOpen}
                  aria-label={frontendMessage(
                    compactSearchOpen ? "config.model.closeSearch" : "config.model.searchPlaceholder",
                  )}
                >
                  <MotionIconSwap stateKey={compactSearchOpen ? "close" : "search"}>
                    <AppIcon icon={compactSearchOpen ? "close" : "search"} size={14} />
                  </MotionIconSwap>
                </button>
              </Tooltip>
            </div>
            <div className="flex items-center gap-1.5">
              {showFetchAction || onAddManualModel ? (
                <div className="inline-flex h-8 overflow-hidden rounded-[7px] border border-line-subtle bg-surface-panel">
                  {showFetchAction ? (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={loading}
                      disabled={disabled || !enabled || !canFetchModels || !selectedProvider?.Id}
                      className="h-full rounded-none border-0 bg-transparent px-2.5 text-[11.5px] shadow-none hover:border-0 hover:bg-surface-hover active:scale-100"
                      onClick={() => onFetch(true)}
                    >
                      <AppIcon icon="refresh" size={12} />
                      {frontendMessage("config.model.fetchList")}
                    </Button>
                  ) : null}
                  {onAddManualModel ? (
                    <Tooltip content={frontendMessage("config.model.customModel")} side="top">
                      <button
                        type="button"
                        disabled={disabled || !selectedProvider}
                        className="grid h-full w-8 place-items-center border-l border-line-subtle text-content-secondary transition hover:bg-surface-hover hover:text-content-primary active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45"
                        onClick={onAddManualModel}
                        aria-label={frontendMessage("config.model.addCustomModel")}
                      >
                        <AppIcon icon="plus" size={12} />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <ListHeader
          title={frontendMessage("config.model.title")}
          subtitle={modelListSubtitle(selectedProvider, rows.length)}
          action={
            <div className="flex items-center gap-1.5">
              <Tooltip content={frontendMessage("config.model.modelGroups")} side="top">
                <button
                  type="button"
                  disabled={disabled}
                  className={iconButtonClassName}
                  onClick={onOpenModelGroups}
                  aria-label={frontendMessage("config.model.modelGroups")}
                >
                  <AppIcon icon="tag" size={14} />
                </button>
              </Tooltip>
              {onAddManualModel ? (
                <Tooltip content={frontendMessage("config.model.manualAdd")} side="top">
                  <button
                    type="button"
                    disabled={disabled || !selectedProvider}
                    className={iconButtonClassName}
                    onClick={onAddManualModel}
                    aria-label={frontendMessage("config.model.manualAdd")}
                  >
                    <AppIcon icon="plus" size={14} />
                  </button>
                </Tooltip>
              ) : null}
              {showFetchAction ? (
                <IconButton
                  label={frontendMessage("config.model.fetchList")}
                  tooltip={frontendMessage("config.model.fetchList")}
                  tooltipSide="top"
                  loading={loading}
                  disabled={disabled || !enabled || !canFetchModels || !selectedProvider?.Id}
                  className={iconButtonClassName}
                  onClick={() => onFetch(true)}
                >
                  <AppIcon icon="refresh" size={14} />
                </IconButton>
              ) : null}
            </div>
          }
        />
      )}
      {compactHeader ? null : (
        <div className="grid gap-2 border-b border-ink-200/70 bg-paper-50/75 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <SearchInput value={search} disabled={disabled || !selectedProvider} onChange={onSearch} />
          <div className="flex min-w-0 items-center justify-end gap-1.5">
            <ProviderCatalogStatus catalog={catalog} error={error} loading={loading} disabled={!enabled} />
          </div>
        </div>
      )}
      {compactHeader ? null : <ModelGroupSummary groups={groups} total={rows.length} onSelectGroup={scrollToGroup} />}
      <ScrollArea className="min-h-0 flex-1 overflow-hidden" viewportClassName="h-full pr-2 [scrollbar-gutter:stable]">
        {modelRows}
      </ScrollArea>
    </div>
  );
}

function ProviderModelRows({
  selectedProvider,
  enabled,
  canFetchModels,
  catalog,
  rows,
  groups,
  models,
  modelTemplate,
  defaultModelId,
  pendingModelIds,
  disabled,
  onConfigureModel,
  onSetDefaultModel,
  onRemoveModel,
  groupedCards,
  onGroupRef,
}: {
  selectedProvider: ProviderEndpointDraft | null;
  enabled: boolean;
  canFetchModels: boolean;
  catalog?: ProviderModelsSnapshotData;
  rows: ProviderModelInfo[];
  groups: ProviderModelGroup[];
  models: ModelProviderDraft[];
  modelTemplate: Record<string, unknown>;
  defaultModelId: string;
  pendingModelIds: ReadonlyMap<string, string>;
  disabled: boolean;
  onConfigureModel: (model: ProviderModelInfo) => void;
  onSetDefaultModel?: (model: ModelProviderDraft) => void;
  onRemoveModel?: (model: ModelProviderDraft) => void;
  groupedCards: boolean;
  onGroupRef: (groupId: string, element: HTMLElement | null) => void;
}): JSX.Element {
  const selectedProviderId = selectedProvider?.Id ?? "";
  const configuredByModel = useMemo(
    () =>
      new Map(models.filter((model) => model.ProviderId === selectedProviderId).map((model) => [model.Model, model])),
    [models, selectedProviderId],
  );
  const { disableMotion } = useMotionLevel();
  const modelListRef = useRef<HTMLDivElement>(null);
  const modelHover = useFluidHover(modelListRef, { axis: "y", gapClick: false });

  if (!selectedProvider) {
    return <EmptyList text={frontendMessage("config.model.addProviderFirst")} />;
  }
  if (!enabled) {
    return <EmptyList text={frontendMessage("config.model.providerDisabled")} />;
  }
  if (!canFetchModels && !catalog && rows.length === 0) {
    return <EmptyList text={frontendMessage("config.model.apiKeyRequired")} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyList
        text={
          configuredByModel.size === 0
            ? frontendMessage("config.model.noConfigured")
            : frontendMessage("config.model.noMatches")
        }
      />
    );
  }

  let rowIndex = 0;
  const showGroupHeaders = groups.length > 1;
  return (
    <div ref={modelListRef} className={cn("relative", groupedCards && "pb-1")} {...modelHover.handlers}>
      <FluidHoverHighlight
        hover={modelHover}
        hidden={disableMotion}
        surfaceClassName="bg-surface-hover/80"
        className={groupedCards ? "rounded-md" : undefined}
      />
      {groups.map((group, groupIndex) => (
        <section
          key={group.id}
          className={cn(
            !groupedCards && "border-b border-line-subtle/70 last:border-b-0",
            groupedCards && showGroupHeaders && groupIndex > 0 && "mt-1",
          )}
        >
          {showGroupHeaders ? (
            <div
              ref={(element) => onGroupRef(group.id, element)}
              className={cn(
                "flex scroll-mt-0 items-center justify-between gap-2.5",
                groupedCards
                  ? "h-8 px-2.5"
                  : "sticky top-0 z-[1] h-8 border-b border-line-subtle/70 bg-surface-subtle px-3",
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="grid w-[20px] shrink-0 place-items-center">
                  <ModelProviderIcon icon={group.icon} size={14} className="rounded" />
                </span>
                <span className="truncate text-[11.5px] font-semibold text-content-secondary">{group.label}</span>
              </span>
              <span className="tabular-nums text-[10.5px] text-content-muted">{group.rows.length}</span>
            </div>
          ) : null}
          {group.rows.map((model) => {
            const index = rowIndex;
            rowIndex += 1;
            return (
              <ProviderModelRow
                key={model.id}
                itemRef={modelHover.getItemRef(index)}
                fluidHoverEnabled={!disableMotion}
                model={model}
                providerId={selectedProvider.Id}
                configured={configuredByModel.get(model.id)}
                defaultModelId={defaultModelId}
                pendingKind={pendingModelIds.get(modelConfigId(selectedProviderId, model.id))}
                modelTemplate={modelTemplate}
                disabled={disabled}
                onConfigureModel={onConfigureModel}
                onSetDefaultModel={onSetDefaultModel}
                onRemoveModel={onRemoveModel}
                groupedCards={groupedCards}
              />
            );
          })}
        </section>
      ))}
    </div>
  );
}

function ProviderModelRow({
  itemRef,
  fluidHoverEnabled,
  model,
  providerId,
  configured,
  defaultModelId,
  pendingKind,
  modelTemplate,
  disabled,
  onConfigureModel,
  onSetDefaultModel,
  onRemoveModel,
  groupedCards,
}: {
  itemRef: (element: HTMLElement | null) => void;
  fluidHoverEnabled: boolean;
  model: ProviderModelInfo;
  providerId: string;
  configured?: ModelProviderDraft;
  defaultModelId: string;
  /** Operation kind pending for this model (upsert/delete/default-set), if any. */
  pendingKind?: string;
  modelTemplate: Record<string, unknown>;
  disabled: boolean;
  onConfigureModel: (model: ProviderModelInfo) => void;
  onSetDefaultModel?: (model: ModelProviderDraft) => void;
  onRemoveModel?: (model: ModelProviderDraft) => void;
  groupedCards: boolean;
}): JSX.Element {
  const isDefault = configured?.Id === defaultModelId;
  const capabilities = configured
    ? readModelCapabilities(configured, modelTemplate, model.modelsDev)
    : defaultModelCapabilities(modelTemplate, model.id, providerId, model.modelsDev);
  const modelActionClassName = groupedCards
    ? "grid h-6 w-6 shrink-0 place-items-center rounded-[5px] border border-transparent bg-transparent text-content-secondary transition hover:border-line-subtle hover:bg-surface-hover hover:text-content-primary active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45"
    : iconButtonClassName;
  const modelConfigClassName = groupedCards
    ? "grid h-6 w-6 shrink-0 place-items-center rounded-[5px] border border-transparent bg-transparent text-content-secondary transition hover:bg-surface-hover hover:text-content-primary active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45"
    : iconButtonClassName;

  return (
    <div
      ref={itemRef}
      className={cn(
        "group/model relative z-10 grid min-w-0 items-center transition [content-visibility:auto] [contain-intrinsic-size:54px]",
        groupedCards
          ? "grid-cols-[20px_minmax(0,1fr)_minmax(56px,auto)] gap-2.5 rounded-md py-1.5 pl-2.5 pr-2"
          : "grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-3 py-2.5",
        !groupedCards && (fluidHoverEnabled ? "hover:bg-transparent" : "hover:bg-surface-hover/80"),
      )}
    >
      <span className="grid h-5 w-[20px] shrink-0 place-items-center">
        <ModelProviderIcon
          icon={
            configured?.Icon ??
            inferModelProviderIcon(readProviderModelOwnedBy(model), false) ??
            inferModelProviderIcon(model.id, false) ??
            inferModelProviderEndpointIcon(providerId, false)
          }
          size={18}
          className="rounded"
        />
      </span>
      <span className={cn("min-w-0", groupedCards && "flex flex-col items-start")}>
        <span className="flex min-w-0 items-center gap-1.5">
          <Tooltip content={model.id} side="top">
            <span className="block truncate text-[13.5px] font-medium leading-5 text-content-primary">{model.id}</span>
          </Tooltip>
          {groupedCards ? <ConfiguredModelBadge isDefault={isDefault} compact /> : null}
        </span>
        {groupedCards ? (
          <span className="mt-1 flex min-w-0 items-center gap-1">
            <CapabilityIconStrip capabilities={capabilities} metadata={model.modelsDev} labels />
          </span>
        ) : (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[10.5px] text-ink-400">
              {readProviderModelOwnedBy(model) || frontendMessage("config.model.providerModel")}
            </span>
            <CapabilityIconStrip capabilities={capabilities} metadata={model.modelsDev} />
          </span>
        )}
      </span>
      <span className={cn("flex justify-end gap-0.5", groupedCards ? "h-5 w-14 items-center" : "items-start")}>
        {groupedCards ? null : <ConfiguredModelBadge isDefault={isDefault} />}
        {pendingKind ? (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-ink-600">
            <Spinner size="xs" className="text-accent-content" /> {pendingModelOperationLabel(pendingKind)}
          </span>
        ) : configured ? (
          <>
            <Tooltip content={frontendMessage("chat.model.configure")} side="top">
              <button
                type="button"
                disabled={disabled || !providerId}
                className={modelConfigClassName}
                aria-label={frontendMessage("chat.model.configure")}
                onClick={() => onConfigureModel(model)}
              >
                {groupedCards ? (
                  <AppIcon icon="settings" size={14} />
                ) : (
                  <AdjustmentsHorizontalIcon className="h-3.5 w-3.5" />
                )}
              </button>
            </Tooltip>
            {onRemoveModel || (!isDefault && onSetDefaultModel) ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled || !providerId}
                    className={modelActionClassName}
                    aria-label={frontendMessage("chat.action.more")}
                  >
                    <AppIcon icon="more" size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 bg-paper-50">
                  {!isDefault && onSetDefaultModel ? (
                    <DropdownMenuItem
                      icon={<AppIcon icon="star" size={14} />}
                      onSelect={() => onSetDefaultModel(configured)}
                    >
                      {frontendMessage("chat.model.setDefault")}
                    </DropdownMenuItem>
                  ) : null}
                  {!isDefault && onSetDefaultModel && onRemoveModel ? <DropdownMenuSeparator /> : null}
                  {onRemoveModel ? (
                    <DropdownMenuItem
                      icon={<AppIcon icon="trash" size={14} />}
                      destructive
                      onSelect={() => onRemoveModel(configured)}
                    >
                      {frontendMessage("chat.model.remove")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        ) : (
          <Tooltip content={frontendMessage("chat.model.configure")} side="top">
            <button
              type="button"
              disabled={disabled || !providerId}
              className={modelConfigClassName}
              aria-label={frontendMessage("chat.model.configure")}
              onClick={() => onConfigureModel(model)}
            >
              {groupedCards ? (
                <AppIcon icon="settings" size={14} />
              ) : (
                <AdjustmentsHorizontalIcon className="h-3.5 w-3.5" />
              )}
            </button>
          </Tooltip>
        )}
      </span>
    </div>
  );
}

function ConfiguredModelBadge({
  isDefault,
  compact = false,
}: {
  isDefault: boolean;
  compact?: boolean;
}): JSX.Element | null {
  if (isDefault) {
    return (
      <Tooltip content={frontendMessage("config.model.default")} side="top">
        <span
          aria-label={frontendMessage("config.model.default")}
          className={cn(
            "shrink-0 text-[10px] font-medium leading-none",
            compact
              ? "inline-flex h-[18px] items-center rounded-[5px] bg-moss-50 px-1.5 text-[10.5px] text-moss-600"
              : "rounded-full border border-accent-border bg-accent-surface px-1.5 py-1 text-accent-content",
          )}
        >
          {frontendMessage("config.model.default")}
        </span>
      </Tooltip>
    );
  }
  return null;
}

function ModelGroupSummary({
  groups,
  total,
  onSelectGroup,
}: {
  groups: ProviderModelGroup[];
  total: number;
  onSelectGroup: (groupId: string | null) => void;
}): JSX.Element | null {
  const { disableMotion } = useMotionLevel();
  const groupListRef = useRef<HTMLDivElement>(null);
  const groupHover = useFluidHover(groupListRef, { axis: "x", gapClick: false });
  if (groups.length === 0) {
    return null;
  }
  return (
    <div className="border-b border-ink-200/70 bg-paper-50 px-2.5 py-2">
      <div ref={groupListRef} className="relative flex min-w-0 flex-wrap gap-1" {...groupHover.handlers}>
        <FluidHoverHighlight
          hover={groupHover}
          hidden={disableMotion}
          surfaceClassName="bg-ink-900/[0.035]"
          className="rounded-md"
        />
        <Tooltip content={frontendMessage("config.model.allModelsTitle", { count: total })} side="top">
          <button
            type="button"
            ref={groupHover.getItemRef(0)}
            className={cn(
              "relative z-10 inline-flex h-7 shrink-0 items-center gap-1.5 border-b border-accent-border px-1.5 text-[11px] text-ink-800 transition-colors duration-150 hover:text-accent-content-hover",
              !disableMotion && "hover:bg-transparent",
            )}
            onClick={() => onSelectGroup(null)}
          >
            <AppIcon icon="tag" size={14} />
            <span className="font-medium">{frontendMessage("config.model.allModels")}</span>
            <span className="tabular-nums text-[10px] text-ink-400">{total}</span>
          </button>
        </Tooltip>
        {groups.map((group, index) => (
          <Tooltip key={group.id} content={`${group.label}: ${group.rows.length}`} side="top">
            <button
              type="button"
              ref={groupHover.getItemRef(index + 1)}
              className={cn(
                "relative z-10 inline-flex h-7 shrink-0 items-center gap-1.5 border-b border-transparent px-1.5 text-[11px] text-ink-650 transition-colors duration-150 hover:border-ink-350 hover:text-ink-850",
                !disableMotion && "hover:bg-transparent",
              )}
              onClick={() => onSelectGroup(group.id)}
            >
              <ModelProviderIcon icon={group.icon} size={14} className="rounded" />
              <span className="max-w-24 truncate font-medium">{group.label}</span>
              <span className="tabular-nums text-[10px] text-ink-400">{group.rows.length}</span>
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function modelListSubtitle(selectedProvider: ProviderEndpointDraft | null, visibleRows: number): string {
  if (!selectedProvider) {
    return frontendMessage("config.model.selectProviderHint");
  }
  if (!providerEnabled(selectedProvider)) {
    return frontendMessage("config.model.providerDisabled");
  }
  return frontendMessage("config.model.configuredCount", { count: visibleRows });
}
