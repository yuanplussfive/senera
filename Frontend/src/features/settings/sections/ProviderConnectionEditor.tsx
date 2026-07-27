import { Eye, EyeOff, Plus, RotateCcw, Server, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { SettingsConfigCommands } from "../SettingsContracts";
import { cn } from "../../../lib/util";
import {
  Button,
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  FormHint,
  Input,
  Switch,
} from "../../../shared/ui";
import { inferModelProviderIcon, ModelProviderIcon } from "../../chat/ModelProviderIcon";
import { DetailTitle, EmptyDetail, IconAction, inputClassName } from "../../chat/ModelConfigPrimitives";
import { isRedactedConfigSecret, providerEnabled, providerIdLabel } from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import { ProviderFormError } from "./ProviderConnectionFeedback";
import { isProtectedProvider } from "./ProviderConnectionIdentity";

interface HeaderRow {
  id: number;
  name: string;
  value: string;
}

let headerRowSeed = 0;

function toHeaderRows(headers: Record<string, string>): HeaderRow[] {
  return Object.entries(headers).map(([name, value]) => ({ id: ++headerRowSeed, name, value }));
}

function rowsToHeaders(rows: readonly HeaderRow[]): Record<string, string> {
  return Object.fromEntries(rows.filter((row) => row.name.trim()).map((row) => [row.name, row.value]));
}

// Case-insensitive: HTTP header names are case-insensitive, so "Auth"/"auth"
// would collide at the transport layer even though the object keeps both.
function readDuplicateHeaderNames(rows: readonly HeaderRow[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim().toLowerCase();
    if (!name) continue;
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  return duplicates;
}

export function ProviderConnectionEditor({
  acceptedProvider,
  dirty,
  draftProvider,
  disabled,
  localError,
  operation,
  providerModelCount,
  providerIndex,
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
  onChange: (patch: Partial<ProviderEndpointDraft>) => void;
  onConfirm: (patch?: Partial<ProviderEndpointDraft>) => void;
  onDelete?: () => void;
}): JSX.Element {
  const [showKey, setShowKey] = useState(false);
  const [requestConfigOpen, setRequestConfigOpen] = useState(false);
  const [requestHeadersDraft, setRequestHeadersDraft] = useState<HeaderRow[]>([]);
  const provider = draftProvider;
  const providerId = provider?.Id;

  useEffect(() => {
    setShowKey(false);
  }, [providerId]);

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
  const storedApiKey = isRedactedConfigSecret(provider.ApiKey);
  const pending = operation?.status === "pending";
  const operationError = operation?.status === "error" ? operation.message : null;
  const errorMessage = localError ?? operationError;
  const duplicateHeaderNames = readDuplicateHeaderNames(requestHeadersDraft);

  return (
    <div className="bg-paper-50">
      <div className="mx-auto w-full max-w-[960px] px-5 py-4 lg:px-7">
        <DetailTitle
          icon={<ModelProviderIcon icon={provider.Icon || inferModelProviderIcon(provider.Id)} size={22} />}
          title={providerIdLabel(provider)}
          subtitle={readProviderConnectionSubtitle({
            enabled,
            protectedProvider,
            providerModelCount,
          })}
          actions={
            <>
              {errorMessage && dirty ? (
                <Button size="sm" variant="outline" disabled={disabled || pending} onClick={() => onConfirm()}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {frontendMessage("settings.action.retry")}
                </Button>
              ) : null}
              <Switch
                checked={enabled}
                disabled={disabled}
                ariaLabel={providerIdLabel(provider)}
                className="h-8 w-10 justify-center"
                onCheckedChange={(Enabled) => onConfirm({ Enabled })}
              />
              <IconAction
                label={frontendMessage("settings.provider.apiConfig")}
                disabled={disabled}
                onClick={() => {
                  setRequestHeadersDraft(toHeaderRows(provider.Headers ?? {}));
                  setRequestConfigOpen(true);
                }}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </IconAction>
              {onDelete ? (
                <IconAction
                  label={frontendMessage("settings.provider.delete")}
                  danger
                  disabled={disabled || protectedProvider}
                  onClick={onDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconAction>
              ) : null}
            </>
          }
        />

        <div className="grid gap-3">
          <ConnectionField label={frontendMessage("settings.provider.apiKey")}>
            <div className="flex h-9 min-w-0 overflow-hidden rounded-md border border-ink-200 bg-paper-50 transition focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus">
              <input
                type={showKey && !storedApiKey ? "text" : "password"}
                value={storedApiKey ? "" : (provider.ApiKey ?? "")}
                disabled={disabled}
                placeholder={storedApiKey ? frontendMessage("settings.provider.apiKeyStored") : "sk-..."}
                spellCheck={false}
                className={cn(inputClassName, "h-full font-mono")}
                onChange={(event) => {
                  onChange({ ApiKey: event.currentTarget.value });
                }}
                onBlur={() => onConfirm()}
              />
              <button
                type="button"
                disabled={storedApiKey}
                className="grid h-9 w-9 shrink-0 place-items-center border-l border-ink-200 text-ink-450 transition hover:text-ink-800 disabled:pointer-events-none disabled:opacity-40"
                onClick={() => setShowKey((current) => !current)}
                aria-label={frontendMessage(showKey ? "config.provider.hideApiKey" : "config.provider.showApiKey")}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </ConnectionField>
          <ConnectionField label={frontendMessage("settings.provider.apiUrl")}>
            <div className="flex h-9 min-w-0 overflow-hidden rounded-md border border-ink-200 bg-paper-50 transition focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus">
              <input
                value={provider.BaseUrl ?? ""}
                disabled={disabled}
                placeholder="https://.../v1"
                spellCheck={false}
                className={cn(inputClassName, "h-full font-mono")}
                onChange={(event) => {
                  onChange({ BaseUrl: event.currentTarget.value });
                }}
                onBlur={() => onConfirm()}
              />
            </div>
          </ConnectionField>
        </div>

        <div className="mt-2">{errorMessage ? <ProviderFormError message={errorMessage} /> : null}</div>
      </div>
      <Dialog
        open={requestConfigOpen}
        onOpenChange={(open) => {
          // Save-on-close, but never commit a duplicate-name collapse: rowsToHeaders
          // is last-wins, so ESC/X with duplicates would silently drop a header.
          // Match the disabled Confirm button — discard the invalid in-dialog edits
          // (reopening reseeds from the saved headers) instead of corrupting them.
          if (!open && duplicateHeaderNames.size === 0) {
            onConfirm({ Headers: rowsToHeaders(requestHeadersDraft) });
          }
          setRequestConfigOpen(open);
        }}
      >
        <DialogContent
          title={frontendMessage("settings.provider.apiConfig")}
          description={frontendMessage("settings.provider.customHeadersDescription")}
          className="h-[min(680px,calc(100dvh_-_32px))] w-[min(600px,calc(100vw_-_32px))]"
          bodyClassName="flex min-h-0 flex-1 flex-col px-8 pb-7 pt-3"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[12px] font-semibold text-ink-800">
                {frontendMessage("settings.provider.customHeaders")}
              </span>
              <span className="font-mono text-[10.5px] text-ink-500">{"{}"}</span>
            </div>
            <HeadersEditor
              rows={requestHeadersDraft}
              disabled={disabled}
              duplicateNames={duplicateHeaderNames}
              onChange={setRequestHeadersDraft}
            />
            {duplicateHeaderNames.size > 0 ? (
              <div className="mt-3">
                <ProviderFormError message={frontendMessage("settings.provider.duplicateHeaderName")} />
              </div>
            ) : null}
            <FormHint className="mt-3">{frontendMessage("settings.provider.customHeadersHint")}</FormHint>
          </div>
          <DialogActions className="mt-auto">
            <DialogActionButton
              variant="primary"
              disabled={disabled || duplicateHeaderNames.size > 0}
              onClick={() => {
                onConfirm({ Headers: rowsToHeaders(requestHeadersDraft) });
                setRequestConfigOpen(false);
              }}
            >
              {frontendMessage("settings.action.confirm")}
            </DialogActionButton>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConnectionField({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[12px] font-medium text-ink-650">{label}</span>
      {children}
    </label>
  );
}

function HeadersEditor({
  disabled,
  rows,
  duplicateNames,
  onChange,
}: {
  disabled: boolean;
  rows: readonly HeaderRow[];
  duplicateNames: ReadonlySet<string>;
  onChange: (rows: HeaderRow[]) => void;
}): JSX.Element {
  const updateRow = (id: number, patch: Partial<Pick<HeaderRow, "name" | "value">>): void => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <div key={row.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input
            value={row.name}
            placeholder={frontendMessage("settings.provider.headerName")}
            disabled={disabled}
            aria-invalid={duplicateNames.has(row.name.trim().toLowerCase())}
            onChange={(event) => updateRow(row.id, { name: event.currentTarget.value })}
          />
          <Input
            value={isRedactedConfigSecret(row.value) ? "" : row.value}
            placeholder={frontendMessage(
              isRedactedConfigSecret(row.value)
                ? "settings.provider.headerValueStored"
                : "settings.provider.headerValue",
            )}
            disabled={disabled}
            onChange={(event) => updateRow(row.id, { value: event.currentTarget.value })}
          />
          <IconAction
            label={frontendMessage("settings.provider.deleteHeader")}
            danger
            disabled={disabled}
            onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconAction>
        </div>
      ))}
      <Button
        variant="outline"
        disabled={disabled}
        className="w-fit border-dashed"
        onClick={() => onChange([...rows, { id: ++headerRowSeed, name: "", value: "" }])}
      >
        <Plus className="h-3.5 w-3.5" />
        {frontendMessage("settings.provider.addHeader")}
      </Button>
    </div>
  );
}

function readProviderConnectionSubtitle({
  enabled,
  protectedProvider,
  providerModelCount,
}: {
  enabled: boolean;
  protectedProvider: boolean;
  providerModelCount: number;
}): string {
  const identity = frontendMessage(
    protectedProvider ? "settings.provider.builtIn" : "settings.provider.customIdentity",
  );
  const state = frontendMessage(enabled ? "settings.state.enabled" : "settings.state.disabled");
  return frontendMessage("settings.provider.connectionStatus", { identity, state, count: providerModelCount });
}
