import { Loader2, Plus } from "lucide-react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import {
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  FormField,
  FormLabel,
  Input,
  ScrollArea,
} from "../../../shared/ui";
import { groupProviderModelRows, modelConfigId } from "../../chat/modelConfigData";
import type { ModelProviderDraft, ProviderModelInfo } from "../../chat/modelConfigTypes";
import { SettingsWorkspaceState } from "../SettingsWorkspaceSurface";

export function ProviderModelCatalogDialog({
  configuredModels,
  disabled,
  error,
  groups,
  loading,
  onAddModel,
  onOpenChange,
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
  onSearch: (value: string) => void;
  open: boolean;
  pendingModelIds: ReadonlySet<string>;
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
        bodyClassName="min-h-0 flex-1 p-0"
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
            onKeyDown={(event) => event.key === "Enter" && onAdd()}
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
}: {
  rows: ProviderModelInfo[];
  groups: ReturnType<typeof groupProviderModelRows>;
  configuredModels: readonly ModelProviderDraft[];
  pendingModelIds: ReadonlySet<string>;
  providerId: string;
  search: string;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onSearch: (value: string) => void;
  onAddModel: (model: ProviderModelInfo) => void;
}): JSX.Element {
  const configuredIds = new Set(
    configuredModels.filter((model) => model.ProviderId === providerId).map((model) => model.Model),
  );
  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-ink-200/70 bg-paper-50 p-3">
        <input
          value={search}
          disabled={disabled}
          onChange={(event) => onSearch(event.currentTarget.value)}
          aria-label={frontendMessage("settings.modelManagement.search")}
          placeholder={frontendMessage("settings.modelManagement.search")}
          className="h-9 w-full rounded-md border border-ink-200 bg-paper-50 px-3 text-[12.5px] text-ink-800 outline-none focus:border-accent-border focus:ring-2 focus:ring-accent-focus"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {loading ? (
          <SettingsWorkspaceState className="min-h-[260px]">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {frontendMessage("settings.modelManagement.fetching")}
            </span>
          </SettingsWorkspaceState>
        ) : error ? (
          <SettingsWorkspaceState className="min-h-[260px]">
            {frontendMessage("settings.modelManagement.fetchFailed", { error })}
          </SettingsWorkspaceState>
        ) : rows.length > 0 ? (
          <div className="divide-y divide-ink-200/70">
            {groups.map((group) => (
              <section key={group.id}>
                <div className="flex h-8 items-center justify-between border-b border-ink-200/70 bg-paper-100 px-3 text-[11.5px] font-semibold text-ink-700">
                  <span>{group.label}</span>
                  <span className="text-[10.5px] font-normal text-ink-450">{group.rows.length}</span>
                </div>
                {group.rows.map((row) => {
                  const configured = configuredIds.has(row.id);
                  const pending = pendingModelIds.has(modelConfigId(providerId, row.id));
                  return (
                    <div
                      key={row.id}
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[12px] text-ink-850" title={row.id}>
                          {row.id}
                        </div>
                        <div className="mt-0.5 truncate text-[10.5px] text-ink-450">
                          {row.ownedBy || frontendMessage("settings.modelManagement.providerModel")}
                        </div>
                      </div>
                      {configured ? (
                        <span className="text-[10.5px] font-medium text-moss-700">
                          {frontendMessage("settings.modelManagement.added")}
                        </span>
                      ) : pending ? (
                        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-ink-600">
                          <Loader2 className="h-3 w-3 animate-spin" />{" "}
                          {frontendMessage("settings.modelManagement.adding")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={disabled}
                          aria-label={frontendMessage("settings.modelManagement.addModelAria", { model: row.id })}
                          title={frontendMessage("settings.modelManagement.addModel")}
                          className="grid h-8 w-8 place-items-center rounded-md border border-ink-200 bg-paper-50 text-ink-600 transition hover:border-accent-border-strong hover:bg-accent-surface-hover hover:text-accent-content-hover disabled:pointer-events-none disabled:opacity-50"
                          onClick={() => onAddModel(row)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        ) : (
          <SettingsWorkspaceState className="min-h-[260px]">
            {frontendMessage("settings.modelManagement.noMatches")}
          </SettingsWorkspaceState>
        )}
      </ScrollArea>
    </div>
  );
}
