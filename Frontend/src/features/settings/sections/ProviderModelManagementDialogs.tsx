import { Check, Plus } from "lucide-react";
import { useRef } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { cn } from "../../../lib/util";
import {
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  FormField,
  FormLabel,
  Input,
  ScrollArea,
  Skeleton,
  Spinner,
  StateView,
} from "../../../shared/ui";
import { groupProviderModelRows, modelConfigId } from "../../chat/modelConfigData";
import { SearchInput } from "../../chat/ModelConfigPrimitives";
import { inferModelProviderIcon, ModelProviderIcon } from "../../chat/ModelProviderIcon";
import type { ModelProviderDraft, ProviderModelInfo } from "../../chat/modelConfigTypes";

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

export function ProviderModelManualAddDialog({
  disabled,
  modelId,
  onAdd,
  onModelIdChange,
  onOpenChange,
  open,
  providerId,
}: {
  disabled: boolean;
  modelId: string;
  onAdd: () => void;
  onModelIdChange: (modelId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  providerId: string;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("settings.modelManagement.addModelTitle")}
        description={frontendMessage("settings.modelManagement.providerLabel", { provider: providerId })}
        className="min-h-[480px] w-[min(560px,calc(100vw_-_32px))]"
        bodyClassName="flex min-h-0 flex-1 flex-col px-8 pb-7 pt-3"
      >
        <FormField>
          <FormLabel required>{frontendMessage("settings.modelManagement.modelIdLabel")}</FormLabel>
          <Input
            autoFocus
            value={modelId}
            placeholder={frontendMessage("settings.modelManagement.modelIdPlaceholder")}
            onChange={(event) => onModelIdChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !disabled && modelId.trim()) onAdd();
            }}
          />
        </FormField>
        <DialogActions className="mt-auto">
          <DialogActionButton onClick={() => onOpenChange(false)}>
            {frontendMessage("settings.action.cancel")}
          </DialogActionButton>
          <DialogActionButton variant="primary" disabled={disabled || !modelId.trim()} onClick={onAdd}>
            {frontendMessage("settings.action.add")}
          </DialogActionButton>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
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
              <button
                key={group.id}
                type="button"
                className={cn(
                  "inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-ink-200/80 bg-paper-50 px-2.5",
                  "text-[11px] font-medium text-ink-650 transition-colors duration-150",
                  "hover:border-accent-border-strong hover:text-accent-content-hover",
                )}
                title={`${group.label}: ${group.rows.length}`}
                onClick={() => groupRefs.current.get(group.id)?.scrollIntoView({ block: "start", behavior: "smooth" })}
              >
                <ModelProviderIcon icon={group.icon} size={13} className="rounded-sm" />
                <span className="max-w-28 truncate">{group.label}</span>
                <span className="tabular-nums text-[10px] text-ink-400">{group.rows.length}</span>
              </button>
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
          <div className="px-5 pb-6 pt-4">
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
                  {group.rows.map((row) => (
                    <CatalogModelRow
                      key={row.id}
                      row={row}
                      configured={configuredIds.has(row.id)}
                      pending={pendingModelIds.has(modelConfigId(providerId, row.id))}
                      disabled={disabled}
                      onAddModel={onAddModel}
                    />
                  ))}
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
  row,
  configured,
  pending,
  disabled,
  onAddModel,
}: {
  row: ProviderModelInfo;
  configured: boolean;
  pending: boolean;
  disabled: boolean;
  onAddModel: (model: ProviderModelInfo) => void;
}): JSX.Element {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2",
        "transition-colors duration-150 hover:bg-ink-900/[0.03]",
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ink-200/70 bg-paper-100">
        <ModelProviderIcon icon={inferModelProviderIcon(row.id)} size={18} className="rounded" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-mono text-[12.5px] leading-5 text-ink-850" title={row.id}>
          {row.id}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-500">
          {row.ownedBy || frontendMessage("settings.modelManagement.providerModel")}
        </span>
      </span>
      {configured ? (
        <span className="inline-flex items-center gap-1 pr-1 text-[11px] font-medium text-moss-600">
          <Check className="h-3.5 w-3.5" />
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
          <Plus className="h-3.5 w-3.5" />
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
