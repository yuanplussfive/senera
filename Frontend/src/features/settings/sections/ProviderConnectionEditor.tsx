import { EyeOff, Plus, RotateCcw, ScanEye, Server, SlidersHorizontal, Trash2 } from "lucide-react";
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
  MenuSelect,
  Switch,
} from "../../../shared/ui";
import {
  inferModelProviderEndpointIcon,
  ModelProviderIcon,
  ModelProviderIconNames,
  readCustomModelProviderIconSource,
} from "../../chat/ModelProviderIcon";
import { DetailTitle, EmptyDetail, IconAction, inputClassName } from "../../chat/ModelConfigPrimitives";
import { providerIdLabel, isRedactedConfigSecret } from "../../chat/modelConfigData";
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
  providerIndex,
  onReadApiKey,
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
  providerIndex: number;
  onReadApiKey?: (providerId: string) => Promise<string>;
  onChange: (patch: Partial<ProviderEndpointDraft>) => void;
  onConfirm: (patch?: Partial<ProviderEndpointDraft>) => void;
  onDelete?: () => void;
}): JSX.Element {
  const [showKey, setShowKey] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState<string | null>(null);
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null);
  const [requestConfigOpen, setRequestConfigOpen] = useState(false);
  const [requestHeadersDraft, setRequestHeadersDraft] = useState<HeaderRow[]>([]);
  const provider = draftProvider;
  const providerId = provider?.Id;
  const acceptedProviderApiKey = acceptedProvider?.ApiKey;

  useEffect(() => {
    setShowKey(false);
    setApiKeyDraft(null);
    const snapshotApiKey = acceptedProviderApiKey;
    if (typeof snapshotApiKey === "string" && !isRedactedConfigSecret(snapshotApiKey)) {
      setRevealedApiKey(snapshotApiKey);
      return;
    }
    setRevealedApiKey(null);
    if (!providerId || !onReadApiKey) return;
    let current = true;
    void onReadApiKey(providerId).then(
      (apiKey) => {
        if (current) setRevealedApiKey(apiKey);
      },
      () => {
        if (current) setRevealedApiKey("");
      },
    );
    return () => {
      current = false;
    };
  }, [acceptedProviderApiKey, onReadApiKey, providerId]);

  if (!provider || !acceptedProvider || providerIndex < 0) {
    return (
      <EmptyDetail
        icon={<Server className="h-5 w-5" />}
        title={frontendMessage("settings.provider.selectTitle")}
        text={frontendMessage("settings.provider.selectDescription")}
      />
    );
  }

  const protectedProvider = isProtectedProvider(provider.Id);
  const displayedApiKey = apiKeyDraft ?? revealedApiKey ?? "";
  const pending = operation?.status === "pending";
  const operationError = operation?.status === "error" ? operation.message : null;
  const errorMessage = localError ?? operationError;
  const duplicateHeaderNames = readDuplicateHeaderNames(requestHeadersDraft);

  return (
    <div className="bg-paper-50">
      <div className="mx-auto w-full max-w-[980px] px-5 py-4 lg:px-7">
        <DetailTitle
          icon={<ModelProviderIcon icon={provider.Icon || inferModelProviderEndpointIcon(provider.Id)} size={22} />}
          title={providerIdLabel(provider)}
          actions={
            <>
              <Switch
                checked={provider.Enabled !== false}
                size="sm"
                disabled={disabled || pending}
                ariaLabel={frontendMessage("settings.provider.connectionToggle")}
                onCheckedChange={(next) => onConfirm({ Enabled: next })}
              />
              {errorMessage && dirty ? (
                <Button size="sm" variant="outline" disabled={disabled || pending} onClick={() => onConfirm()}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {frontendMessage("settings.action.retry")}
                </Button>
              ) : null}
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

        <div className="grid gap-2.5">
          <ConnectionField label={frontendMessage("settings.provider.apiKey")}>
            <div className="flex h-9 min-w-0 overflow-hidden rounded-md border border-ink-200/80 bg-paper-50 transition-[border-color,box-shadow] focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus">
              <input
                type={showKey ? "text" : "password"}
                value={displayedApiKey}
                disabled={disabled}
                placeholder="sk-..."
                spellCheck={false}
                className={cn(inputClassName, "h-full font-mono")}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setApiKeyDraft(value);
                  onChange({ ApiKey: value });
                }}
                onBlur={() => onConfirm()}
              />
              <button
                type="button"
                disabled={displayedApiKey.length === 0}
                className="grid h-9 w-9 shrink-0 place-items-center text-ink-450 transition hover:bg-ink-900/[0.035] hover:text-ink-800 disabled:pointer-events-none disabled:opacity-40"
                onClick={() => setShowKey((current) => !current)}
                aria-label={frontendMessage(showKey ? "config.provider.hideApiKey" : "config.provider.showApiKey")}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <ScanEye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </ConnectionField>
          <ConnectionField label={frontendMessage("settings.provider.apiUrl")}>
            <div className="flex h-9 min-w-0 overflow-hidden rounded-md border border-ink-200/80 bg-paper-50 transition-[border-color,box-shadow] focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus">
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
          <ProviderLogoField provider={provider} disabled={disabled} onChange={onChange} onConfirm={onConfirm} />
        </div>

        {errorMessage ? (
          <div className="mt-2">
            <ProviderFormError message={errorMessage} />
          </div>
        ) : null}
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
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
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

const CUSTOM_LOGO_OPTION = "__custom__";

function ProviderLogoField({
  provider,
  disabled,
  onChange,
  onConfirm,
}: {
  provider: ProviderEndpointDraft;
  disabled: boolean;
  onChange: (patch: Partial<ProviderEndpointDraft>) => void;
  onConfirm: (patch?: Partial<ProviderEndpointDraft>) => void;
}): JSX.Element {
  const iconValue = provider.Icon?.trim() ?? "";
  const builtInCandidate = ModelProviderIconNames.find(
    (name) => name === iconValue.toLowerCase().replace(/\.svg$/u, ""),
  );
  // Keep the raw value while the user types a URL. The renderer still applies
  // the stricter image-source allow-list, but a controlled input must not erase
  // the first character of a partially entered address.
  const customLogoDraft = builtInCandidate ? "" : iconValue;
  const customLogo = readCustomModelProviderIconSource(customLogoDraft) ?? "";
  const builtInLogo = customLogo ? "" : (builtInCandidate ?? "");
  const selectedValue = customLogo ? CUSTOM_LOGO_OPTION : builtInLogo;
  const inferredLogo = inferModelProviderEndpointIcon(provider.Id);
  const logoOptions = [
    {
      value: "",
      label: frontendMessage("settings.provider.logoAuto"),
      description: frontendMessage("settings.provider.logoAutoDescription"),
    },
    ...(customLogo
      ? [
          {
            value: CUSTOM_LOGO_OPTION,
            label: frontendMessage("settings.provider.logoCustom"),
            description: customLogo,
          },
        ]
      : []),
    ...ModelProviderIconNames.map((name) => ({ value: name, label: formatLogoName(name) })),
  ];

  return (
    <ConnectionField label={frontendMessage("settings.provider.logoLabel")}>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(180px,0.62fr)_minmax(0,1fr)]">
        <MenuSelect
          value={selectedValue}
          placeholder={frontendMessage("settings.provider.logoAuto")}
          ariaLabel={frontendMessage("settings.provider.logoLabel")}
          options={logoOptions}
          disabled={disabled}
          size="md"
          leading={<ModelProviderIcon icon={customLogo || builtInLogo || inferredLogo} size={16} />}
          contentClassName="max-h-[280px] w-[280px]"
          renderValue={(_value, option) => (
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="truncate">{option?.label ?? frontendMessage("settings.provider.logoAuto")}</span>
            </span>
          )}
          renderOption={(option) => (
            <span className="inline-flex min-w-0 items-center gap-2">
              <ModelProviderIcon
                icon={option.value === CUSTOM_LOGO_OPTION ? customLogo : option.value || inferredLogo}
                size={16}
              />
              <span className="min-w-0 truncate">{option.label}</span>
            </span>
          )}
          onChange={(value) =>
            onChange({
              Icon: value === CUSTOM_LOGO_OPTION ? customLogoDraft || undefined : value || undefined,
            })
          }
        />
        <Input
          value={customLogoDraft}
          disabled={disabled}
          placeholder={frontendMessage("settings.provider.logoCustomPlaceholder")}
          spellCheck={false}
          aria-label={frontendMessage("settings.provider.logoCustom")}
          onChange={(event) => onChange({ Icon: event.currentTarget.value || undefined })}
          onBlur={() => onConfirm()}
        />
        <FormHint className="sm:col-span-2">{frontendMessage("settings.provider.logoHint")}</FormHint>
      </div>
    </ConnectionField>
  );
}

function formatLogoName(value: string): string {
  const brandedName = brandedLogoNames[value];
  if (brandedName) return brandedName;
  return value
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}

const brandedLogoNames: Readonly<Record<string, string>> = {
  ai21: "AI21",
  ai302: "AI302",
  ai360: "AI360",
  aihubmix: "AIHubMix",
  anthropic: "Anthropic",
  azureai: "Azure AI",
  baai: "BAAI",
  bfl: "Black Forest Labs",
  cloudflare: "Cloudflare",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  gemini: "Gemini",
  google: "Google",
  lmstudio: "LM Studio",
  newapi: "New API",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ppio: "PPIO",
  qwen: "Qwen",
  siliconcloud: "SiliconFlow",
  sensenova: "SenseNova",
  xai: "xAI",
  zhipu: "Zhipu",
};

function ConnectionField({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="grid min-w-0 gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center sm:gap-3">
      <span className="text-[11.5px] font-medium text-ink-600">{label}</span>
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
