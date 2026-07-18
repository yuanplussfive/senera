import { Check, Eye, EyeOff, Loader2, Plus, RotateCcw, Server, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { SettingsConfigCommands } from "../SettingsContracts";
import { cn } from "../../../lib/util";
import { Button, Dialog, DialogActionButton, DialogActions, DialogContent, FormHint, Input } from "../../../shared/ui";
import { inferModelProviderIcon, ModelProviderIcon } from "../../chat/ModelProviderIcon";
import { DetailTitle, EmptyDetail, IconAction, inputClassName } from "../../chat/ModelConfigPrimitives";
import { nextHeaderKey, providerEnabled, providerIdLabel } from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import { ProviderFormError } from "./ProviderConnectionFeedback";
import { isProtectedProvider } from "./ProviderConnectionIdentity";

export function ProviderConnectionEditor({
  acceptedProvider,
  dirty,
  draftProvider,
  disabled,
  localError,
  operation,
  providerModelCount,
  providerIndex,
  onCancel,
  onChange,
  onConfirm,
  onDelete,
}: {
  acceptedProvider: ProviderEndpointDraft | null;
  dirty: boolean;
  draftProvider: ProviderEndpointDraft | null;
  disabled: boolean;
  localError: string | null;
  operation?: SettingsConfigCommands["providerEndpointOperations"][string];
  providerModelCount: number;
  providerIndex: number;
  onCancel: () => void;
  onChange: (patch: Partial<ProviderEndpointDraft>) => void;
  onConfirm: () => void;
  onDelete?: () => void;
}): JSX.Element {
  const [showKey, setShowKey] = useState(false);
  const [requestConfigOpen, setRequestConfigOpen] = useState(false);
  const [requestHeadersDraft, setRequestHeadersDraft] = useState<Record<string, string>>({});
  const provider = draftProvider;

  if (!provider || !acceptedProvider || providerIndex < 0) {
    return (
      <EmptyDetail
        icon={<Server className="h-5 w-5" />}
        title={frontendMessage("settings.provider.selectTitle")}
        text={frontendMessage("settings.provider.selectDescription")}
      />
    );
  }

  const enabled = providerEnabled(provider);
  const protectedProvider = isProtectedProvider(provider.Id);
  const pending = operation?.status === "pending";
  const operationError = operation?.status === "error" ? operation.message : null;
  const confirmDisabled = disabled || pending || !dirty || !provider.Id.trim();

  return (
    <div className="bg-paper-50">
      <div className="mx-auto w-full max-w-[960px] px-5 py-4 lg:px-7">
        <DetailTitle
          icon={<ModelProviderIcon icon={provider.Icon || inferModelProviderIcon(provider.Id)} size={22} />}
          title={providerIdLabel(provider)}
          subtitle={readProviderConnectionSubtitle({
            dirty,
            enabled,
            operation,
            protectedProvider,
            providerModelCount,
          })}
          actions={
            <>
              {dirty ? (
                <>
                  <Button size="sm" variant="outline" disabled={disabled || pending} onClick={onCancel}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {frontendMessage("settings.action.cancel")}
                  </Button>
                  <Button size="sm" disabled={confirmDisabled} onClick={onConfirm}>
                    {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {frontendMessage("settings.action.save")}
                  </Button>
                </>
              ) : null}
              <button
                type="button"
                disabled={disabled || pending}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12px] font-medium text-ink-650 transition hover:border-accent-border-strong disabled:pointer-events-none disabled:opacity-50"
                onClick={() => onChange({ Enabled: !enabled })}
                aria-pressed={enabled}
              >
                <span className={cn("relative h-5 w-9 rounded-full", enabled ? "bg-moss-500" : "bg-ink-300")}>
                  <span
                    className={cn(
                      "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
                      enabled && "translate-x-4",
                    )}
                  />
                </span>
                {frontendMessage(enabled ? "settings.provider.enabled" : "settings.provider.disabled")}
              </button>
              {onDelete ? (
                <IconAction label={frontendMessage("settings.provider.delete")} danger disabled={disabled || protectedProvider} onClick={onDelete}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconAction>
              ) : null}
            </>
          }
        />

        <div className="grid gap-3">
          <ConnectionField
            label={frontendMessage("settings.provider.apiKey")}
            action={
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-md text-ink-450 transition hover:bg-ink-900/[0.05] hover:text-ink-800"
                onClick={() => {
                  setRequestHeadersDraft({ ...(provider.Headers ?? {}) });
                  setRequestConfigOpen(true);
                }}
                aria-label={frontendMessage("settings.provider.apiConfig")}
                title={frontendMessage("settings.provider.apiConfig")}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            }
          >
            <div className="flex h-9 min-w-0 overflow-hidden rounded-md border border-ink-200 bg-paper-50 transition focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus">
              <input
                type={showKey ? "text" : "password"}
                value={provider.ApiKey ?? ""}
                disabled={disabled || pending}
                placeholder="sk-..."
                spellCheck={false}
                className={cn(inputClassName, "h-full font-mono")}
                onChange={(event) => onChange({ ApiKey: event.currentTarget.value })}
              />
              <button
                type="button"
                className="grid h-9 w-9 shrink-0 place-items-center border-l border-ink-200 text-ink-450 transition hover:text-ink-800"
                onClick={() => setShowKey((current) => !current)}
                aria-label={frontendMessage(showKey ? "config.provider.hideApiKey" : "config.provider.showApiKey")}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </ConnectionField>
          <ConnectionField
            label={frontendMessage("settings.provider.apiUrl")}
            action={
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-md text-ink-450 transition hover:bg-ink-900/[0.05] hover:text-ink-800"
                onClick={() => {
                  setRequestHeadersDraft({ ...(provider.Headers ?? {}) });
                  setRequestConfigOpen(true);
                }}
                aria-label={frontendMessage("settings.provider.apiConfig")}
                title={frontendMessage("settings.provider.apiConfig")}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            }
          >
            <div className="flex h-9 min-w-0 overflow-hidden rounded-md border border-ink-200 bg-paper-50 transition focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus">
              <input
                value={provider.BaseUrl ?? ""}
                disabled={disabled || pending}
                placeholder="https://.../v1"
                spellCheck={false}
                className={cn(inputClassName, "h-full font-mono")}
                onChange={(event) => onChange({ BaseUrl: event.currentTarget.value })}
              />
            </div>
          </ConnectionField>
        </div>

        <div className="mt-2">
          {dirty ? (
            <p className="mt-2 rounded-md border border-ink-200 bg-paper-100 px-3 py-2 text-[12px] leading-5 text-ink-700">
              {frontendMessage("settings.provider.connectionDraftHint")}
            </p>
          ) : null}
          {localError ? <ProviderFormError message={localError} /> : null}
          {operationError ? <ProviderFormError message={operationError} /> : null}
        </div>
      </div>
      <Dialog open={requestConfigOpen} onOpenChange={setRequestConfigOpen}>
        <DialogContent
          title={frontendMessage("settings.provider.apiConfig")}
          description={frontendMessage("settings.provider.customHeadersDescription")}
          className="h-[min(680px,calc(100dvh_-_32px))] w-[min(600px,calc(100vw_-_32px))]"
          bodyClassName="flex min-h-0 flex-1 flex-col px-8 pb-7 pt-3"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[12px] font-semibold text-ink-750">{frontendMessage("settings.provider.customHeaders")}</span>
              <span className="rounded-md border border-ink-200 bg-paper-100 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-500">
                {"{}"}
              </span>
            </div>
            <HeadersEditor
              headers={requestHeadersDraft}
              disabled={disabled || pending}
              onChange={setRequestHeadersDraft}
            />
            <FormHint className="mt-3">{frontendMessage("settings.provider.customHeadersHint")}</FormHint>
          </div>
          <DialogActions className="mt-auto">
            <DialogActionButton onClick={() => setRequestConfigOpen(false)}>{frontendMessage("settings.action.cancel")}</DialogActionButton>
            <DialogActionButton
              variant="primary"
              disabled={disabled || pending}
              onClick={() => {
                onChange({ Headers: requestHeadersDraft });
                setRequestConfigOpen(false);
              }}
            >
              {frontendMessage("settings.action.save")}
            </DialogActionButton>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConnectionField({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 flex items-center justify-between gap-2 text-[12px] font-medium text-ink-650">
        <span>{label}</span>
        {action}
      </span>
      {children}
    </label>
  );
}

function HeadersEditor({
  disabled,
  headers,
  onChange,
}: {
  disabled: boolean;
  headers: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
}): JSX.Element {
  const entries = Object.entries(headers);
  return (
    <div className="grid gap-2">
      {entries.map(([key, value], index) => (
        <div key={`${key}:${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input
            value={key}
            placeholder={frontendMessage("settings.provider.headerName")}
            disabled={disabled}
            onChange={(event) => {
              const next = [...entries];
              next[index] = [event.currentTarget.value, value];
              onChange(Object.fromEntries(next.filter(([entryKey]) => entryKey.trim())));
            }}
          />
          <Input
            value={value}
            placeholder={frontendMessage("settings.provider.headerValue")}
            disabled={disabled}
            onChange={(event) => {
              const next = [...entries];
              next[index] = [key, event.currentTarget.value];
              onChange(Object.fromEntries(next));
            }}
          />
          <IconAction
            label={frontendMessage("settings.provider.deleteHeader")}
            danger
            disabled={disabled}
            onClick={() => onChange(Object.fromEntries(entries.filter((_, entryIndex) => entryIndex !== index)))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconAction>
        </div>
      ))}
      <Button
        variant="outline"
        disabled={disabled}
        className="w-fit border-dashed"
        onClick={() => onChange({ ...headers, [nextHeaderKey(headers)]: "" })}
      >
        <Plus className="h-3.5 w-3.5" />
        {frontendMessage("settings.provider.addHeader")}
      </Button>
    </div>
  );
}

function readProviderConnectionSubtitle({
  dirty,
  enabled,
  operation,
  protectedProvider,
  providerModelCount,
}: {
  dirty: boolean;
  enabled: boolean;
  operation?: SettingsConfigCommands["providerEndpointOperations"][string];
  protectedProvider: boolean;
  providerModelCount: number;
}): string {
  if (operation?.status === "pending") {
    return frontendMessage("settings.provider.savingConnection");
  }
  if (operation?.status === "error") {
    return frontendMessage("settings.provider.lastSaveFailed");
  }
  const identity = frontendMessage(protectedProvider ? "settings.provider.builtIn" : "settings.provider.customIdentity");
  const state = frontendMessage(enabled ? "settings.state.enabled" : "settings.state.disabled");
  const draft = frontendMessage(dirty ? "settings.provider.unsavedChanges" : "settings.provider.fieldsSynced");
  return frontendMessage("settings.provider.connectionStatus", { identity, state, count: providerModelCount, draft });
}
