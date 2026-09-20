import { useEffect, useRef, useState } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { ProviderModelEndpointKind } from "../../../api/providerModelCommandTypes";
import { cn } from "../../../lib/util";
import {
  AppIcon,
  Button,
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  FormField,
  FormLabel,
  Input,
  MenuSelect,
  SecretInput,
} from "../../../shared/ui";
import { ModelProviderIcon } from "../../chat/ModelProviderIcon";
import { isRedactedConfigSecret, normalizeProviderEndpointDraft } from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import { ProviderFormError } from "./ProviderConnectionFeedback";
import { isProtectedProvider, providerPresets } from "./ProviderConnectionIdentity";

// Presets seed both the connection fields and the default protocol for new models.

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

export function AddProviderDialog({
  open,
  providers,
  pending = false,
  error = null,
  onAdd,
  onOpenChange,
}: {
  open: boolean;
  providers: readonly ProviderEndpointDraft[];
  /** True while the add command is in flight; blocks resubmission. */
  pending?: boolean;
  /** Failure message from the add command, shown inside the dialog. */
  error?: string | null;
  onAdd: (provider: ProviderEndpointDraft, endpoint: ProviderModelEndpointKind) => void;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <ProviderConfigDialog
      mode="add"
      open={open}
      providers={providers}
      pending={pending}
      error={error}
      onOpenChange={onOpenChange}
      onAdd={onAdd}
    />
  );
}

export function EditProviderDialog({
  open,
  provider,
  pending = false,
  error = null,
  onReadApiKey,
  onSave,
  onOpenChange,
}: {
  open: boolean;
  provider: ProviderEndpointDraft | null;
  pending?: boolean;
  error?: string | null;
  onReadApiKey?: (providerId: string) => Promise<string>;
  onSave: (patch: Partial<ProviderEndpointDraft>) => void;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <ProviderConfigDialog
      mode="edit"
      open={open}
      provider={provider}
      pending={pending}
      error={error}
      onReadApiKey={onReadApiKey}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  );
}

function ProviderConfigDialog({
  mode,
  open,
  provider,
  providers = [],
  pending = false,
  error = null,
  onReadApiKey,
  onAdd,
  onSave,
  onOpenChange,
}: {
  mode: "add" | "edit";
  open: boolean;
  provider?: ProviderEndpointDraft | null;
  providers?: readonly ProviderEndpointDraft[];
  pending?: boolean;
  error?: string | null;
  onReadApiKey?: (providerId: string) => Promise<string>;
  onAdd?: (provider: ProviderEndpointDraft, endpoint: ProviderModelEndpointKind) => void;
  onSave?: (patch: Partial<ProviderEndpointDraft>) => void;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const editing = mode === "edit";
  const [providerId, setProviderId] = useState("");
  const [presetId, setPresetId] = useState<string>(providerPresets[0]?.id ?? "");
  const [defaultEndpoint, setDefaultEndpoint] = useState<ProviderModelEndpointKind>(
    providerPresets[0]?.endpoint ?? "ChatCompletions",
  );
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const apiKeyTouched = useRef(false);
  const firstPreset = providerPresets[0];
  const providerRef = useRef(provider);
  const firstPresetRef = useRef(firstPreset);
  providerRef.current = provider;
  firstPresetRef.current = firstPreset;
  const preset = providerPresets.find((entry) => entry.id === presetId) ?? providerPresets[0];
  const duplicate =
    !editing && providerId.trim()
      ? providers.some((entry) => entry.Id === providerId.trim()) || isProtectedProvider(providerId.trim())
      : false;
  const duplicateHeaderNames = readDuplicateHeaderNames(headers);
  const invalid = !providerId.trim() || duplicate || duplicateHeaderNames.size > 0;

  useEffect(() => {
    const currentProvider = providerRef.current;
    const currentFirstPreset = firstPresetRef.current;
    if (!open) return;
    apiKeyTouched.current = false;
    setMoreOpen(false);
    if (editing && currentProvider) {
      setProviderId(currentProvider.Id);
      setDefaultEndpoint(currentProvider.DefaultEndpoint ?? currentFirstPreset?.endpoint ?? "ChatCompletions");
      setBaseUrl(currentProvider.BaseUrl ?? "");
      setApiKey(isRedactedConfigSecret(currentProvider.ApiKey ?? "") ? "" : (currentProvider.ApiKey ?? ""));
      setHeaders(toHeaderRows(currentProvider.Headers ?? {}));
      setMoreOpen(Object.keys(currentProvider.Headers ?? {}).length > 0);
      return;
    }
    setProviderId("");
    setPresetId(currentFirstPreset?.id ?? "");
    setDefaultEndpoint(currentFirstPreset?.endpoint ?? "ChatCompletions");
    setBaseUrl(currentFirstPreset?.baseUrl ?? "");
    setApiKey("");
    setHeaders(toHeaderRows(currentFirstPreset?.headers ?? {}));
  }, [editing, open, provider?.DefaultEndpoint, provider?.Id]);

  useEffect(() => {
    const currentProvider = providerRef.current;
    if (!open || !editing || !currentProvider || !onReadApiKey || !isRedactedConfigSecret(currentProvider.ApiKey ?? ""))
      return;
    let current = true;
    void onReadApiKey(currentProvider.Id).then(
      (value) => {
        if (current && !apiKeyTouched.current) setApiKey(value);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [editing, onReadApiKey, open, provider?.ApiKey, provider?.Id]);

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen && pending) return;
    onOpenChange(nextOpen);
  };

  const submit = (): void => {
    const id = providerId.trim();
    if (!id || invalid || pending) return;
    const nextHeaders = rowsToHeaders(headers);
    if (editing) {
      if (!provider || !onSave) return;
      const patch: Partial<ProviderEndpointDraft> = {
        BaseUrl: baseUrl.trim(),
        DefaultEndpoint: defaultEndpoint,
        Headers: nextHeaders,
      };
      if (!isRedactedConfigSecret(provider.ApiKey ?? "") || apiKeyTouched.current || apiKey) {
        patch.ApiKey = apiKey.trim();
      }
      onSave(patch);
      return;
    }
    if (!preset || !onAdd) return;
    onAdd(
      normalizeProviderEndpointDraft({
        Id: id,
        Icon: preset.icon,
        Enabled: true,
        Kind: "OpenAICompatible",
        BaseUrl: baseUrl.trim() || preset.baseUrl,
        ApiKey: apiKey.trim(),
        ApiVersion: preset.apiVersion ?? "2023-06-01",
        Headers: nextHeaders,
      }),
      defaultEndpoint,
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        title={frontendMessage(editing ? "settings.provider.editTitle" : "settings.provider.addCustomTitle")}
        className="w-[min(520px,calc(100vw_-_32px))]"
        bodyClassName="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-5 pt-5"
        footer={
          <DialogActions>
            <DialogActionButton disabled={pending} onClick={() => handleOpenChange(false)}>
              {frontendMessage("settings.action.cancel")}
            </DialogActionButton>
            <DialogActionButton
              variant="primary"
              disabled={invalid || pending || (editing && !provider)}
              onClick={submit}
            >
              {frontendMessage(
                error ? "settings.action.retry" : editing ? "settings.action.save" : "settings.provider.add",
              )}
            </DialogActionButton>
          </DialogActions>
        }
        showClose={!pending}
      >
        <div className="grid gap-4">
          <FormField>
            <FormLabel className="text-[12px] text-content-secondary" required>
              {frontendMessage("settings.provider.nameLabel")}
            </FormLabel>
            <Input
              autoFocus={!editing}
              value={providerId}
              placeholder={frontendMessage("settings.provider.namePlaceholder")}
              aria-label={frontendMessage("settings.provider.nameLabel")}
              aria-invalid={duplicate}
              disabled={pending || editing}
              className="h-9 rounded-[7px] px-[11px] text-[13px]"
              onChange={(event) => setProviderId(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !invalid && !pending) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </FormField>

          {editing ? (
            <FormField>
              <FormLabel className="text-[12px] text-content-secondary">
                {frontendMessage("settings.provider.defaultEndpointLabel")}
              </FormLabel>
              <MenuSelect
                value={defaultEndpoint}
                placeholder={frontendMessage("settings.provider.defaultEndpointPlaceholder")}
                ariaLabel={frontendMessage("settings.provider.defaultEndpointLabel")}
                options={[
                  {
                    value: "ChatCompletions",
                    label: frontendMessage("settings.provider.endpointChatCompletions"),
                  },
                  {
                    value: "Responses",
                    label: frontendMessage("settings.provider.endpointResponses"),
                  },
                  {
                    value: "ClaudeMessages",
                    label: frontendMessage("settings.provider.endpointClaudeMessages"),
                  },
                  {
                    value: "GoogleGenerateContent",
                    label: frontendMessage("settings.provider.endpointGoogleGenerateContent"),
                  },
                ]}
                disabled={pending}
                size="md"
                triggerClassName="rounded-[7px] px-[11px] text-[13px]"
                contentClassName="w-[300px]"
                onChange={(value) => setDefaultEndpoint(value as ProviderModelEndpointKind)}
              />
            </FormField>
          ) : (
            <FormField>
              <FormLabel className="text-[12px] text-content-secondary">
                {frontendMessage("settings.provider.presetLabel")}
              </FormLabel>
              <MenuSelect
                value={presetId}
                placeholder={frontendMessage("settings.provider.presetPlaceholder")}
                ariaLabel={frontendMessage("settings.provider.presetLabel")}
                options={providerPresets.map((entry) => ({ value: entry.id, label: entry.label }))}
                disabled={pending}
                size="md"
                triggerClassName="rounded-[7px] px-[11px] text-[13px]"
                contentClassName="w-[300px]"
                renderValue={(value) => {
                  const current = providerPresets.find((entry) => entry.id === value);
                  return current ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <ModelProviderIcon icon={current.icon} size={16} />
                      <span className="truncate leading-none">{current.label}</span>
                    </span>
                  ) : null;
                }}
                renderOption={(option) => {
                  const current = providerPresets.find((entry) => entry.id === option.value);
                  return current ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <ModelProviderIcon icon={current.icon} size={16} />
                      <span className="truncate">{current.label}</span>
                    </span>
                  ) : (
                    option.label
                  );
                }}
                onChange={(nextPresetId) => {
                  setPresetId(nextPresetId);
                  const nextPreset = providerPresets.find((entry) => entry.id === nextPresetId);
                  if (nextPreset) {
                    setDefaultEndpoint(nextPreset.endpoint);
                    setBaseUrl(nextPreset.baseUrl);
                    setHeaders(toHeaderRows(nextPreset.headers ?? {}));
                  }
                }}
              />
            </FormField>
          )}

          <FormField>
            <FormLabel className="text-[12px] text-content-secondary">
              {frontendMessage("settings.provider.apiUrl")}
            </FormLabel>
            <Input
              value={baseUrl}
              placeholder="https://.../v1"
              disabled={pending}
              spellCheck={false}
              className="h-9 rounded-[7px] px-[11px] font-mono text-[12.5px]"
              onChange={(event) => setBaseUrl(event.currentTarget.value)}
            />
          </FormField>

          <FormField>
            <FormLabel className="text-[12px] text-content-secondary">
              {frontendMessage("settings.provider.apiKey")}
            </FormLabel>
            <SecretInput
              key={`${open ? "open" : "closed"}-${provider?.Id ?? "new"}`}
              value={apiKey}
              disabled={pending}
              placeholder={frontendMessage("settings.provider.apiKeyPlaceholder")}
              ariaLabel={frontendMessage("settings.provider.apiKey")}
              showLabel={frontendMessage("config.provider.showApiKey")}
              hideLabel={frontendMessage("config.provider.hideApiKey")}
              hideRevealWhenEmpty
              className="font-mono text-[12.5px] px-[11px]"
              onChange={(value) => {
                apiKeyTouched.current = true;
                setApiKey(value);
              }}
            />
          </FormField>

          <div className="pt-1">
            <button
              type="button"
              disabled={pending}
              aria-expanded={moreOpen}
              className="inline-flex items-center gap-1.5 text-left text-[12px] text-content-secondary transition-colors hover:text-content-primary disabled:pointer-events-none disabled:opacity-50"
              onClick={() => setMoreOpen((current) => !current)}
            >
              {frontendMessage("settings.provider.moreSettings")}
              <AppIcon
                icon="chevron-down"
                size={14}
                className={cn("text-content-muted transition-transform", moreOpen && "rotate-180")}
              />
            </button>
            {moreOpen ? (
              <div className="mt-3 grid gap-2">
                <FormLabel className="text-[12px] text-content-secondary">
                  {frontendMessage("settings.provider.customHeaders")}
                </FormLabel>
                <HeadersEditor
                  rows={headers}
                  disabled={pending}
                  duplicateNames={duplicateHeaderNames}
                  onChange={setHeaders}
                />
                {duplicateHeaderNames.size > 0 ? (
                  <ProviderFormError message={frontendMessage("settings.provider.duplicateHeaderName")} />
                ) : null}
              </div>
            ) : null}
          </div>
          {duplicate ? <ProviderFormError message={frontendMessage("settings.provider.duplicate")} /> : null}
          {error ? <ProviderFormError message={error} /> : null}
        </div>
      </DialogContent>
    </Dialog>
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
          <button
            type="button"
            aria-label={frontendMessage("settings.provider.deleteHeader")}
            disabled={disabled}
            className="grid h-9 w-9 place-items-center rounded-md text-content-muted transition hover:bg-surface-hover hover:text-danger disabled:pointer-events-none disabled:opacity-40"
            onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))}
          >
            <AppIcon icon="trash" size={14} />
          </button>
        </div>
      ))}
      <Button
        variant="outline"
        disabled={disabled}
        className="w-fit border-dashed"
        onClick={() => onChange([...rows, { id: ++headerRowSeed, name: "", value: "" }])}
      >
        <AppIcon icon="plus" size={14} />
        {frontendMessage("settings.provider.addHeader")}
      </Button>
    </div>
  );
}

export function RenameProviderDialog({
  provider,
  providers,
  error,
  onOpenChange,
  onRename,
}: {
  provider: ProviderEndpointDraft | null;
  providers: readonly ProviderEndpointDraft[];
  /** Rename conflict reported by the actions layer (e.g. unsaved edits). */
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onRename: (providerId: string, nextProviderId: string) => void;
}): JSX.Element {
  const [nextProviderId, setNextProviderId] = useState("");
  const open = Boolean(provider);

  useEffect(() => {
    setNextProviderId(provider?.Id ?? "");
  }, [provider]);

  const targetId = nextProviderId.trim();
  const invalid =
    !provider ||
    !targetId ||
    targetId === provider.Id ||
    providers.some((entry) => entry.Id === targetId) ||
    isProtectedProvider(targetId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("settings.provider.renameTitle")}
        description={frontendMessage("settings.provider.renameDescription")}
        className="min-h-[420px] w-[min(560px,calc(100vw_-_32px))]"
        bodyClassName="flex min-h-0 flex-1 flex-col px-8 pb-7 pt-3"
        footerClassName="px-8"
        footer={
          <DialogActions>
            <DialogActionButton onClick={() => onOpenChange(false)}>
              {frontendMessage("settings.action.cancel")}
            </DialogActionButton>
            <DialogActionButton
              variant="primary"
              disabled={invalid}
              onClick={() => provider && onRename(provider.Id, targetId)}
            >
              <span className="inline-flex items-center gap-1.5">
                <AppIcon icon="pencil" size={14} />
                {frontendMessage("settings.action.rename")}
              </span>
            </DialogActionButton>
          </DialogActions>
        }
      >
        <div>
          <FormField>
            <FormLabel required>{frontendMessage("settings.provider.newNameLabel")}</FormLabel>
            <Input
              autoFocus
              value={nextProviderId}
              aria-invalid={Boolean(
                targetId &&
                targetId !== provider?.Id &&
                (providers.some((entry) => entry.Id === targetId) || isProtectedProvider(targetId)),
              )}
              onChange={(event) => setNextProviderId(event.currentTarget.value)}
            />
          </FormField>
          {targetId &&
          targetId !== provider?.Id &&
          (providers.some((entry) => entry.Id === targetId) || isProtectedProvider(targetId)) ? (
            <ProviderFormError message={frontendMessage("settings.provider.nameConflict")} />
          ) : null}
          {error ? <ProviderFormError message={error} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
