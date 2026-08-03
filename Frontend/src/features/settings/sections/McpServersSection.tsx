import { useEffect, useMemo, useState } from "react";
import { Folder, KeyRound, RefreshCw, RotateCcw, RotateCw, Save, ServerCog, Settings2 } from "lucide-react";
import type { McpInputStatus, McpInputValue, McpServerSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { cn } from "../../../lib/util";
import {
  Button,
  FormField,
  FormHint,
  FormLabel,
  IconButton,
  InlineError,
  Input,
  MenuMultiSelect,
  MenuSelect,
  ScrollArea,
  StateView,
  Switch,
} from "../../../shared/ui";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";

const EmptyMcpServers: readonly McpServerSettingsItem[] = [];
type McpInputDraft = McpInputValue | "";

export function McpServersSection({
  systemConfig,
  onDirtyChange,
}: {
  systemConfig?: SettingsSystemConfigHandle;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const locale = useFrontendLocale();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, McpInputDraft>>({});
  const [deletes, setDeletes] = useState<string[]>([]);
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const servers = systemConfig?.mcpServers ?? EmptyMcpServers;
  const selectedServer = servers.find((server) => server.id === selectedServerId) ?? servers[0];
  const dirty = Object.keys(drafts).length > 0 || deletes.length > 0;
  const saving = Boolean(
    saveRequestId &&
    systemConfig?.mcpInputOperation?.requestId === saveRequestId &&
    systemConfig.mcpInputOperation.status === "pending",
  );
  const connected = systemConfig?.socketStatus === "open";
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (servers.length === 0) {
      setSelectedServerId(null);
      setDrafts({});
      setDeletes([]);
      return;
    }
    if (!servers.some((server) => server.id === selectedServerId)) {
      setSelectedServerId(servers[0]?.id ?? null);
      setDrafts({});
      setDeletes([]);
    }
  }, [selectedServerId, servers]);

  useEffect(() => {
    if (!saveRequestId || systemConfig?.mcpInputOperation?.requestId !== saveRequestId) return;
    if (systemConfig.mcpInputOperation.status === "success") {
      setSaveRequestId(null);
      setDrafts({});
      setDeletes([]);
      setOperationError(null);
    } else if (systemConfig.mcpInputOperation.status === "error") {
      setSaveRequestId(null);
      setOperationError(systemConfig.mcpInputOperation.message ?? frontendMessage("settings.mcp.saveFailed"));
    }
  }, [saveRequestId, systemConfig?.mcpInputOperation]);

  if (!systemConfig || !systemConfig.toolSettingsSynced.mcpServers) {
    return <StateView status="loading" description={frontendMessage("settings.mcp.loading")} />;
  }

  const selectServer = (serverId: string): void => {
    if (dirty || saving) return;
    setSelectedServerId(serverId);
    setDrafts({});
    setDeletes([]);
    setOperationError(null);
  };
  const updateDraft = (input: McpInputStatus, value: McpInputDraft): void => {
    setDrafts((current) => {
      const next = { ...current };
      const baseline = input.secret ? "" : (input.value ?? input.defaultValue ?? "");
      if (sameDraft(value, baseline)) delete next[input.id];
      else next[input.id] = value;
      return next;
    });
    setDeletes((current) => current.filter((inputId) => inputId !== input.id));
    setOperationError(null);
  };
  const toggleReset = (input: McpInputStatus): void => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[input.id];
      return next;
    });
    setDeletes((current) =>
      current.includes(input.id) ? current.filter((inputId) => inputId !== input.id) : [...current, input.id],
    );
    setOperationError(null);
  };
  const discard = (): void => {
    setDrafts({});
    setDeletes([]);
    setOperationError(null);
  };
  const save = (): void => {
    if (!selectedServer) return;
    const values: Record<string, McpInputValue> = {};
    try {
      for (const input of selectedServer.inputs) {
        if (!(input.id in drafts)) continue;
        const draft = drafts[input.id];
        if (input.secret && draft === "") continue;
        const value = normalizeDraft(input, draft ?? "");
        if (input.required && isEmptyValue(value)) {
          throw new InputValidationError(frontendMessage("settings.mcp.inputValueRequired", { name: input.title }));
        }
        values[input.id] = value;
      }
      for (const inputId of deletes) {
        const input = selectedServer.inputs.find((candidate) => candidate.id === inputId);
        if (input?.required && input.defaultValue === undefined && input.source !== "environment") {
          throw new InputValidationError(frontendMessage("settings.mcp.inputValueRequired", { name: input.title }));
        }
      }
    } catch (error) {
      setOperationError(
        error instanceof InputValidationError
          ? error.message
          : frontendMessage("settings.mcp.inputValueInvalid", { name: selectedServer.id }),
      );
      return;
    }
    const requestId = systemConfig.updateMcpInputs(selectedServer.id, values, deletes);
    if (!requestId) {
      setOperationError(frontendMessage("settings.mcp.commandUnavailable"));
      return;
    }
    setSaveRequestId(requestId);
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([inputId]) => {
          const input = selectedServer.inputs.find((candidate) => candidate.id === inputId);
          return !input?.secret;
        }),
      ),
    );
    setOperationError(null);
  };
  const restartServer = (): void => {
    if (!selectedServer || systemConfig.restartMcpServer(selectedServer.id)) {
      setOperationError(null);
      return;
    }
    setOperationError(frontendMessage("settings.mcp.commandUnavailable"));
  };

  return (
    <section className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(180px,36%)_minmax(0,1fr)] overflow-hidden bg-paper-50 md:grid-cols-[272px_minmax(0,1fr)] md:grid-rows-1">
      <div className="flex min-h-0 flex-col border-b border-ink-200/70 md:border-b-0 md:border-r">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-ink-200/70 px-3">
          <div className="text-[12px] text-ink-500">
            {frontendMessage("settings.mcp.count", { count: servers.length })}
          </div>
          <IconButton
            label={frontendMessage("settings.mcp.refresh")}
            tooltip={frontendMessage("settings.mcp.refresh")}
            size="sm"
            tone="muted"
            disabled={!connected || saving}
            onClick={systemConfig.refreshToolSettings}
          >
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        </div>
        {servers.length === 0 ? (
          <StateView
            status="empty"
            icon={<ServerCog className="h-4 w-4 text-ink-400" />}
            title={frontendMessage("settings.mcp.empty")}
          />
        ) : (
          <ScrollArea className="min-h-0 flex-1" viewportClassName="p-2">
            <div className="space-y-0.5">
              {servers.map((server) => (
                <McpServerRow
                  key={server.id}
                  server={server}
                  selected={server.id === selectedServer?.id}
                  disabled={(dirty || saving) && server.id !== selectedServer?.id}
                  onSelect={() => selectServer(server.id)}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
      {selectedServer ? (
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex min-w-0 shrink-0 flex-wrap items-start justify-between gap-3 border-b border-ink-200/70 px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-[15px] font-semibold text-ink-900">{selectedServer.id}</h3>
                <McpStatus status={selectedServer.status} />
              </div>
              <p className="mt-1 text-[11.5px] text-ink-500">
                {frontendMessage("settings.mcp.serverMetadata", {
                  packageName: selectedServer.packageName,
                  source: frontendMessage(`settings.mcp.source.${selectedServer.source}`),
                  transport: selectedServer.transport,
                  descriptor: selectedServer.descriptorKind,
                })}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={!connected || saving} onClick={restartServer}>
              <RotateCw className="h-3.5 w-3.5" />
              {frontendMessage("settings.mcp.restart")}
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
            {operationError ? <InlineError className="mx-4 mt-3 sm:mx-5">{operationError}</InlineError> : null}
            <div className="px-4 py-4 sm:px-5">
              <div className="mb-2 text-[12px] font-semibold text-ink-800">
                {frontendMessage("settings.mcp.inputs")}
              </div>
              {selectedServer.inputs.length === 0 ? (
                <div className="border-y border-ink-200/70 py-8 text-center text-[12px] text-ink-500">
                  {frontendMessage("settings.mcp.noInputs")}
                </div>
              ) : (
                <div className="divide-y divide-ink-200/70 border-y border-ink-200/70">
                  {selectedServer.inputs.map((input) => {
                    const deleted = deletes.includes(input.id);
                    const value = deleted
                      ? (input.defaultValue ?? "")
                      : (drafts[input.id] ?? input.value ?? input.defaultValue ?? "");
                    return (
                      <div
                        key={input.id}
                        className={cn(
                          "grid gap-3 py-4 lg:grid-cols-[minmax(180px,0.5fr)_minmax(260px,1fr)] lg:gap-6",
                          deleted && "opacity-65",
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[12px] font-semibold text-ink-800">{input.title}</span>
                            {input.required ? (
                              <span className="text-[10.5px] text-brick-600">
                                {frontendMessage("settings.mcp.required")}
                              </span>
                            ) : null}
                          </div>
                          <code className="mt-0.5 block truncate text-[10.5px] text-ink-400">{input.id}</code>
                          <div className="mt-1 text-[11px] leading-4 text-ink-500">
                            {deleted
                              ? frontendMessage("settings.mcp.inputSource.reset")
                              : frontendMessage(`settings.mcp.inputSource.${input.source}`)}
                            {!deleted && input.updatedAt ? ` · ${dateFormatter.format(new Date(input.updatedAt))}` : ""}
                          </div>
                        </div>
                        <FormField className="min-w-0 gap-1.5">
                          <FormLabel className="sr-only">{input.title}</FormLabel>
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <McpInputControl
                                input={input}
                                value={value}
                                disabled={!connected || saving || deleted}
                                onChange={(next) => updateDraft(input, next)}
                              />
                            </div>
                            {input.stored ? (
                              <IconButton
                                label={frontendMessage(
                                  deleted ? "settings.mcp.cancelReset" : "settings.mcp.resetInput",
                                  { name: input.title },
                                )}
                                tooltip={frontendMessage(
                                  deleted ? "settings.mcp.cancelReset" : "settings.mcp.resetInput",
                                  { name: input.title },
                                )}
                                size="sm"
                                tone={deleted ? "muted" : "danger"}
                                disabled={!connected || saving}
                                onClick={() => toggleReset(input)}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </IconButton>
                            ) : null}
                          </div>
                          {input.description ? <FormHint>{input.description}</FormHint> : null}
                        </FormField>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-ink-200/70 bg-paper-100 px-4 py-2.5 sm:px-5">
            <div className="text-[11px] text-ink-500" aria-live="polite">
              {saving
                ? frontendMessage("settings.mcp.saving")
                : dirty
                  ? frontendMessage("settings.mcp.unsaved")
                  : frontendMessage("settings.mcp.saved")}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={discard}>
                <RotateCcw className="h-3.5 w-3.5" />
                {frontendMessage("settings.mcp.discard")}
              </Button>
              <Button size="sm" disabled={!dirty || !connected || saving} onClick={save}>
                <Save className="h-3.5 w-3.5" />
                {frontendMessage("settings.mcp.saveChanges")}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <StateView status="empty" title={frontendMessage("settings.mcp.selectServer")} />
      )}
    </section>
  );
}

function McpInputControl({
  input,
  value,
  disabled,
  onChange,
}: {
  input: McpInputStatus;
  value: McpInputDraft;
  disabled: boolean;
  onChange: (value: McpInputDraft) => void;
}): JSX.Element {
  if (input.multiple && (input.choices?.length || input.type === "boolean")) {
    const choices = input.choices?.length ? input.choices : [false, true];
    const selectedValues = Array.isArray(value) ? value : value === "" ? [] : [value];
    const options = choices.map((choice) => ({ value: JSON.stringify(choice), label: formatInputValue(choice) }));
    return (
      <MenuMultiSelect
        values={selectedValues.map((entry) => JSON.stringify(entry))}
        placeholder={input.placeholder ?? frontendMessage("settings.mcp.inputPlaceholder")}
        options={options}
        disabled={disabled}
        ariaLabel={input.title}
        onChange={(values) => onChange(parseMultipleChoiceValues(input.type, values))}
      />
    );
  }
  if (input.type === "boolean") {
    return <Switch checked={value === true} disabled={disabled} ariaLabel={input.title} onCheckedChange={onChange} />;
  }
  if (input.choices?.length) {
    const options = input.choices.map((choice) => ({ value: JSON.stringify(choice), label: formatInputValue(choice) }));
    return (
      <MenuSelect
        value={value === "" ? "" : JSON.stringify(value)}
        placeholder={input.placeholder ?? frontendMessage("settings.mcp.inputPlaceholder")}
        options={options}
        disabled={disabled}
        ariaLabel={input.title}
        onChange={(next) => onChange(JSON.parse(next) as McpInputValue)}
      />
    );
  }
  const Icon = input.secret ? KeyRound : input.type === "filepath" || input.type === "directory" ? Folder : Settings2;
  return (
    <div className="relative min-w-0">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-350" />
      <Input
        type={input.secret ? "password" : input.type === "number" ? "number" : "text"}
        autoComplete={input.secret ? "new-password" : "off"}
        spellCheck={false}
        min={input.min}
        max={input.max}
        value={formatDraftValue(value)}
        disabled={disabled}
        placeholder={
          input.secret && input.configured
            ? frontendMessage("settings.mcp.secretReplacePlaceholder")
            : (input.placeholder ?? frontendMessage("settings.mcp.inputPlaceholder"))
        }
        aria-label={input.title}
        className="h-9 rounded-md pl-9 text-[12.5px]"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function normalizeDraft(input: McpInputStatus, draft: McpInputDraft): McpInputValue {
  if (input.multiple) {
    const values = Array.isArray(draft)
      ? draft
      : String(draft)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
    if (input.type === "number") {
      const numbers = values.map(Number);
      if (numbers.some((value) => !Number.isFinite(value))) throw new Error("Invalid number array.");
      return numbers;
    }
    if (input.type === "boolean") return values.map((value) => value === true || value === "true");
    return values.map(String);
  }
  if (input.type === "number") {
    if (draft === "") throw new Error("Number input is empty.");
    const value = Number(draft);
    if (!Number.isFinite(value)) throw new Error("Invalid number.");
    return value;
  }
  if (input.type === "boolean") return draft === true || draft === "true";
  return String(draft);
}

function parseMultipleChoiceValues(type: McpInputStatus["type"], values: readonly string[]): McpInputValue {
  const parsed: unknown[] = values.map((entry) => JSON.parse(entry) as unknown);
  if (type === "number" && parsed.every((entry): entry is number => typeof entry === "number")) return parsed;
  if (type === "boolean" && parsed.every((entry): entry is boolean => typeof entry === "boolean")) return parsed;
  if (parsed.every((entry): entry is string => typeof entry === "string")) return parsed;
  throw new Error(`Invalid ${type} choice value.`);
}

function isEmptyValue(value: McpInputValue): boolean {
  return value === "" || (Array.isArray(value) && value.length === 0);
}

function formatDraftValue(value: McpInputDraft): string | number {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "boolean" ? String(value) : value;
}

function formatInputValue(value: McpInputValue): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function sameDraft(left: McpInputDraft, right: McpInputDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function McpServerRow({
  server,
  selected,
  disabled,
  onSelect,
}: {
  server: McpServerSettingsItem;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "grid min-h-[54px] w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
        selected
          ? "bg-accent-surface text-accent-content"
          : "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
        disabled && "cursor-not-allowed opacity-50",
      )}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{server.id}</span>
        <span className="mt-0.5 block truncate text-[10.5px] text-ink-500">
          {server.packageName} · {server.transport}
        </span>
      </span>
      <span
        aria-label={frontendMessage(`settings.mcp.status.${server.status}`)}
        className={cn("h-2 w-2 rounded-full", server.status === "configured" ? "bg-accent-solid" : "bg-brick-500")}
      />
    </button>
  );
}

function McpStatus({ status }: { status: McpServerSettingsItem["status"] }): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-[11px]",
        status === "configured" ? "text-accent-content" : "text-brick-600",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", status === "configured" ? "bg-accent-solid" : "bg-brick-500")}
      />
      {frontendMessage(`settings.mcp.status.${status}`)}
    </span>
  );
}

class InputValidationError extends Error {}
