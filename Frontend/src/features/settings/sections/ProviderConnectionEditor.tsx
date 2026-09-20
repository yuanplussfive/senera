import { useCallback, useEffect, useRef, useState } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { SettingsConfigCommands } from "../SettingsContracts";
import { cn } from "../../../lib/util";
import {
  AppIcon,
  Button,
  FormHint,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SecretInput,
  Switch,
  Tooltip,
} from "../../../shared/ui";
import {
  inferModelProviderEndpointIcon,
  ModelProviderIcon,
  ModelProviderIconNames,
  ProviderMark,
  readCustomModelProviderIconSource,
} from "../../chat/ModelProviderIcon";
import { EmptyDetail, IconAction } from "../../chat/ModelConfigPrimitives";
import { providerIdLabel, isRedactedConfigSecret } from "../../chat/modelConfigData";
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
  providerIndex,
  onReadApiKey,
  onChange,
  onConfirm,
  onLocalDraftChange,
  onEdit,
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
  onLocalDraftChange?: (dirty: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}): JSX.Element {
  const provider = draftProvider;
  const providerId = provider?.Id;
  const [apiKeyDraft, setApiKeyDraft] = useState<string | null>(null);
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null);
  const [baseUrlDraft, setBaseUrlDraft] = useState(provider?.BaseUrl ?? "");
  const acceptedProviderApiKey = acceptedProvider?.ApiKey;
  const apiKeyDraftRef = useRef(apiKeyDraft);
  const baseUrlDraftRef = useRef(baseUrlDraft);
  const apiKeyDirtyRef = useRef(false);
  const baseUrlDirtyRef = useRef(false);
  const logoDirtyRef = useRef(false);
  const localDraftDirtyRef = useRef(false);
  const onLocalDraftChangeRef = useRef(onLocalDraftChange);
  apiKeyDraftRef.current = apiKeyDraft;
  baseUrlDraftRef.current = baseUrlDraft;
  onLocalDraftChangeRef.current = onLocalDraftChange;

  const setLocalFieldDirty = useCallback((field: "apiKey" | "baseUrl" | "logo", dirty: boolean): void => {
    if (field === "apiKey") apiKeyDirtyRef.current = dirty;
    else if (field === "baseUrl") baseUrlDirtyRef.current = dirty;
    else logoDirtyRef.current = dirty;
    const nextDirty = apiKeyDirtyRef.current || baseUrlDirtyRef.current || logoDirtyRef.current;
    if (nextDirty === localDraftDirtyRef.current) return;
    localDraftDirtyRef.current = nextDirty;
    onLocalDraftChangeRef.current?.(nextDirty);
  }, []);

  useEffect(() => {
    if (apiKeyDirtyRef.current) return;
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

  useEffect(() => {
    if (baseUrlDirtyRef.current) return;
    setBaseUrlDraft(provider?.BaseUrl ?? "");
  }, [provider?.BaseUrl, providerId]);

  useEffect(() => {
    return () => {
      baseUrlDirtyRef.current = false;
      apiKeyDirtyRef.current = false;
      logoDirtyRef.current = false;
      if (localDraftDirtyRef.current) {
        localDraftDirtyRef.current = false;
        onLocalDraftChangeRef.current?.(false);
      }
    };
  }, [providerId]);

  if (!provider || !acceptedProvider || providerIndex < 0) {
    return (
      <EmptyDetail
        icon={<AppIcon icon="server" size={20} />}
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
  const ghostIconActionClassName =
    "grid h-7 w-7 shrink-0 place-items-center rounded-md border border-transparent bg-transparent text-content-secondary transition hover:border-line-subtle hover:bg-surface-hover hover:text-content-primary disabled:pointer-events-none disabled:opacity-45 active:scale-[0.95]";

  return (
    <div className="bg-surface-soft text-content-primary">
      <div className="w-full px-0 py-4">
        <div className="flex min-w-0 items-start justify-between gap-4 border-b border-line-subtle/70 pb-5">
          <div className="flex min-w-0 items-center gap-4">
            <ProviderAvatarPicker
              provider={provider}
              disabled={disabled || pending}
              onChange={onChange}
              onConfirm={onConfirm}
              onLocalDraftChange={(dirty) => setLocalFieldDirty("logo", dirty)}
            />
            <div className="min-w-0">
              <span className="block truncate text-[22px] font-semibold leading-7 text-content-primary">
                {providerIdLabel(provider)}
              </span>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-content-muted">
                <span className="inline-flex max-w-full truncate rounded-md bg-surface-subtle px-2 py-0.5 text-[12px] text-content-secondary">
                  {providerProtocolLabel(provider.DefaultEndpoint)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Switch
              checked={provider.Enabled !== false}
              size="sm"
              disabled={disabled || pending}
              ariaLabel={frontendMessage("settings.provider.connectionToggle")}
              onCheckedChange={(next) => onConfirm({ Enabled: next })}
            />
            {errorMessage && dirty ? (
              <Button size="sm" variant="outline" disabled={disabled || pending} onClick={() => onConfirm()}>
                <AppIcon icon="refresh" size={14} />
                {frontendMessage("settings.action.retry")}
              </Button>
            ) : null}
            {onEdit ? (
              <IconAction
                label={frontendMessage("settings.provider.edit")}
                disabled={disabled}
                className={ghostIconActionClassName}
                onClick={onEdit}
              >
                <AppIcon icon="settings" size={14} />
              </IconAction>
            ) : null}
            {onDelete ? (
              <IconAction
                label={frontendMessage("settings.provider.delete")}
                danger
                disabled={disabled || protectedProvider}
                className={ghostIconActionClassName}
                onClick={onDelete}
              >
                <AppIcon icon="trash" size={14} />
              </IconAction>
            ) : null}
          </div>
        </div>
        <div className="grid gap-4 py-5">
          <ConnectionField
            label={frontendMessage("settings.provider.apiUrl")}
            hint={frontendMessage("settings.provider.apiUrlHint")}
            inline
          >
            <div className="flex h-11 min-w-0 items-center overflow-hidden rounded-[10px] border border-line-subtle bg-surface-panel px-3 transition-[border-color,box-shadow] focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus">
              <input
                value={baseUrlDraft}
                disabled={disabled}
                aria-label={frontendMessage("settings.provider.apiUrl")}
                placeholder="https://.../v1"
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent font-mono text-[12px] text-content-primary outline-none placeholder:font-sans placeholder:text-content-muted"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  baseUrlDraftRef.current = value;
                  setBaseUrlDraft(value);
                  setLocalFieldDirty("baseUrl", true);
                }}
                onBlur={() => {
                  if (!baseUrlDirtyRef.current) return;
                  onConfirm({ BaseUrl: baseUrlDraftRef.current });
                  setLocalFieldDirty("baseUrl", false);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  if (!baseUrlDirtyRef.current) return;
                  onConfirm({ BaseUrl: baseUrlDraftRef.current });
                  setLocalFieldDirty("baseUrl", false);
                  event.currentTarget.blur();
                }}
              />
            </div>
          </ConnectionField>
          <ConnectionField
            label={frontendMessage("settings.provider.apiKey")}
            hint={frontendMessage("settings.provider.apiKeyHint")}
            inline
          >
            <SecretInput
              key={providerId ?? "empty"}
              size="md"
              value={displayedApiKey}
              disabled={disabled}
              placeholder="sk-..."
              ariaLabel={frontendMessage("settings.provider.apiKey")}
              showLabel={frontendMessage("config.provider.showApiKey")}
              hideLabel={frontendMessage("config.provider.hideApiKey")}
              hideRevealWhenEmpty
              className="font-mono text-[12px] placeholder:font-sans"
              onChange={(value) => {
                apiKeyDraftRef.current = value;
                setApiKeyDraft(value);
                setLocalFieldDirty("apiKey", true);
              }}
              onBlur={() => {
                if (apiKeyDirtyRef.current && apiKeyDraftRef.current !== null) {
                  onConfirm({ ApiKey: apiKeyDraftRef.current });
                }
                setLocalFieldDirty("apiKey", false);
              }}
              trailing={
                <Tooltip content={frontendMessage("clipboard.pasteFromClipboard")} side="top">
                  <button
                    type="button"
                    disabled={disabled}
                    className="grid h-8 w-7 shrink-0 place-items-center rounded text-content-muted transition hover:bg-surface-hover hover:text-content-primary disabled:pointer-events-none disabled:opacity-30 active:scale-[0.95]"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={async () => {
                      try {
                        const clipText = await navigator.clipboard.readText();
                        if (clipText) {
                          apiKeyDraftRef.current = clipText;
                          setApiKeyDraft(clipText);
                          setLocalFieldDirty("apiKey", true);
                          onConfirm({ ApiKey: clipText });
                          setLocalFieldDirty("apiKey", false);
                        }
                      } catch {
                        // ignore if clipboard permission denied
                      }
                    }}
                    aria-label={frontendMessage("clipboard.pasteFromClipboard")}
                  >
                    <AppIcon icon="copy" size={13} />
                  </button>
                </Tooltip>
              }
            />
          </ConnectionField>
        </div>

        {errorMessage ? (
          <div className="mt-2">
            <ProviderFormError message={errorMessage} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProviderAvatarPicker({
  provider,
  disabled,
  onChange,
  onConfirm,
  onLocalDraftChange,
}: {
  provider: ProviderEndpointDraft;
  disabled: boolean;
  onChange: (patch: Partial<ProviderEndpointDraft>) => void;
  onConfirm: (patch?: Partial<ProviderEndpointDraft>) => void;
  onLocalDraftChange: (dirty: boolean) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const iconValue = provider.Icon?.trim() ?? "";
  const builtInCandidate = ModelProviderIconNames.find(
    (name) => name === iconValue.toLowerCase().replace(/\.svg$/u, ""),
  );
  const [customLogoDraft, setCustomLogoDraft] = useState(() => (builtInCandidate ? "" : iconValue));
  const customLogoDraftRef = useRef(customLogoDraft);
  const customLogoDirtyRef = useRef(false);
  const onLocalDraftChangeRef = useRef(onLocalDraftChange);
  customLogoDraftRef.current = customLogoDraft;
  onLocalDraftChangeRef.current = onLocalDraftChange;

  useEffect(() => {
    if (customLogoDirtyRef.current) return;
    const nextDraft = builtInCandidate ? "" : iconValue;
    customLogoDraftRef.current = nextDraft;
    setCustomLogoDraft(nextDraft);
  }, [builtInCandidate, iconValue, provider.Id]);

  useEffect(() => {
    return () => {
      customLogoDirtyRef.current = false;
      onLocalDraftChangeRef.current(false);
    };
  }, [provider.Id]);

  const effectiveIconValue = customLogoDirtyRef.current ? customLogoDraft.trim() : iconValue;
  const effectiveBuiltInCandidate = ModelProviderIconNames.find(
    (name) => name === effectiveIconValue.toLowerCase().replace(/\.svg$/u, ""),
  );
  const customLogo = readCustomModelProviderIconSource(effectiveIconValue) ?? "";
  const builtInLogo = customLogo ? "" : (effectiveBuiltInCandidate ?? "");
  const inferredLogo = inferModelProviderEndpointIcon(provider.Id);
  const activeIcon = customLogo || builtInLogo || inferredLogo;
  const isAuto = !effectiveIconValue;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={frontendMessage("settings.provider.logoLabel")}
          className="group relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-line-subtle bg-surface-subtle outline-none transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-soft focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-50"
        >
          <ProviderMark icon={activeIcon} label={provider.Id} size={38} />
          <span
            className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-ink-200 bg-paper-50 text-ink-500 shadow-sm transition-colors group-hover:bg-content-strong group-hover:text-content-inverse"
            aria-hidden="true"
          >
            <AppIcon icon="pencil" size={10} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-[300px] border-line-subtle bg-surface-panel p-3.5"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-content-strong">
            {frontendMessage("settings.provider.logoLabel")}
          </span>
          <button
            type="button"
            disabled={isAuto}
            onClick={() => {
              customLogoDraftRef.current = "";
              setCustomLogoDraft("");
              customLogoDirtyRef.current = false;
              onLocalDraftChange(false);
              onChange({ Icon: undefined });
              onConfirm({ Icon: undefined });
              setOpen(false);
            }}
            className="text-[11px] text-content-muted transition hover:text-accent-content disabled:pointer-events-none disabled:opacity-40"
          >
            {frontendMessage("settings.provider.logoAuto")}
          </button>
        </div>

        <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-content-muted">
          {frontendMessage("settings.group.model")}
        </div>
        <div className="scrollbar-thin mb-3 grid max-h-[190px] grid-cols-5 gap-1.5 overflow-y-auto p-0.5">
          {ModelProviderIconNames.map((name) => {
            const isSelected = builtInLogo === name;
            return (
              <button
                key={name}
                type="button"
                title={formatLogoName(name)}
                onClick={() => {
                  customLogoDraftRef.current = "";
                  setCustomLogoDraft("");
                  customLogoDirtyRef.current = false;
                  onLocalDraftChange(false);
                  onChange({ Icon: name });
                  onConfirm({ Icon: name });
                  setOpen(false);
                }}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border p-1 transition",
                  isSelected
                    ? "border-accent-border bg-accent-surface ring-1 ring-accent-focus"
                    : "border-line-subtle bg-surface-subtle hover:border-accent-border hover:bg-surface-hover",
                )}
              >
                <ModelProviderIcon icon={name} size={18} />
                <span className="max-w-[44px] truncate text-[9.5px] text-content-secondary leading-none">
                  {formatLogoName(name)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-content-muted">
          {frontendMessage("settings.provider.logoCustom")}
        </div>
        <div className="flex flex-col gap-1">
          <Input
            size="sm"
            value={customLogoDraft}
            disabled={disabled}
            placeholder={frontendMessage("settings.provider.logoCustomPlaceholder")}
            spellCheck={false}
            aria-label={frontendMessage("settings.provider.logoCustom")}
            className="text-[12px] font-mono"
            onChange={(event) => {
              const value = event.currentTarget.value;
              customLogoDraftRef.current = value;
              setCustomLogoDraft(value);
              customLogoDirtyRef.current = true;
              onLocalDraftChange(true);
            }}
            onBlur={() => {
              if (!customLogoDirtyRef.current) return;
              onConfirm({ Icon: customLogoDraftRef.current || undefined });
              customLogoDirtyRef.current = false;
              onLocalDraftChange(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (customLogoDirtyRef.current) {
                  onConfirm({ Icon: customLogoDraftRef.current || undefined });
                  customLogoDirtyRef.current = false;
                  onLocalDraftChange(false);
                }
                setOpen(false);
              }
            }}
          />
          <FormHint className="text-[10px] leading-tight">{frontendMessage("settings.provider.logoHint")}</FormHint>
        </div>
      </PopoverContent>
    </Popover>
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

function providerProtocolLabel(endpoint: ProviderEndpointDraft["DefaultEndpoint"]): string {
  switch (endpoint ?? "ChatCompletions") {
    case "Responses":
      return frontendMessage("settings.provider.endpointResponses");
    case "ChatCompletions":
      return frontendMessage("settings.provider.endpointChatCompletions");
    case "ClaudeMessages":
      return frontendMessage("settings.provider.endpointClaudeMessages");
    case "GoogleGenerateContent":
      return frontendMessage("settings.provider.endpointGoogleGenerateContent");
  }
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

function ConnectionField({
  label,
  hint,
  inline = false,
  children,
}: {
  label: string;
  hint?: string;
  inline?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-1.5",
        inline && "sm:max-w-[520px] sm:grid-cols-[72px_minmax(0,1fr)] sm:items-center sm:gap-3",
      )}
    >
      <div className="flex items-center gap-1.5 text-[13.5px] font-medium text-content-primary">
        <span>{label}</span>
        {hint ? (
          <Tooltip content={hint} side="top">
            <span className="inline-flex cursor-help text-content-muted opacity-70 transition-opacity hover:opacity-100">
              <AppIcon icon="alert" size={12} className="rotate-180" />
            </span>
          </Tooltip>
        ) : null}
      </div>
      {children}
    </div>
  );
}
