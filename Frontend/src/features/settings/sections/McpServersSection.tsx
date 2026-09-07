import { useEffect, useState, type ElementType } from "react";
import AdjustmentsHorizontalIcon from "@heroicons/react/24/outline/AdjustmentsHorizontalIcon";
import ArrowLeftIcon from "@heroicons/react/24/outline/ArrowLeftIcon";
import ArrowPathIcon from "@heroicons/react/24/outline/ArrowPathIcon";
import ArrowPathRoundedSquareIcon from "@heroicons/react/24/outline/ArrowPathRoundedSquareIcon";
import FolderIcon from "@heroicons/react/24/outline/FolderIcon";
import KeyIcon from "@heroicons/react/24/outline/KeyIcon";
import PauseCircleIcon from "@heroicons/react/24/outline/PauseCircleIcon";
import ServerStackIcon from "@heroicons/react/24/outline/ServerStackIcon";
import type { McpInputStatus, McpInputValue, McpServerSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText } from "../../../i18n/frontendLocaleModel";
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
  Spinner,
  StateView,
  Switch,
} from "../../../shared/ui";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";

const EmptyMcpServers: readonly McpServerSettingsItem[] = [];
const McpInputSyncDebounceMs = 350;
type McpInputDraft = McpInputValue | "";

interface McpSyncRequest {
  requestId: string;
  serverId: string;
  values: Record<string, McpInputValue>;
}

export function McpServersSection({
  systemConfig,
  onDirtyChange,
}: {
  systemConfig?: SettingsSystemConfigHandle;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, McpInputDraft>>({});
  const [syncRequest, setSyncRequest] = useState<McpSyncRequest | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const locale = useFrontendLocale();
  const servers = systemConfig?.mcpServers ?? EmptyMcpServers;
  const selectedServer = selectedServerId ? (servers.find((server) => server.id === selectedServerId) ?? null) : null;
  const selectedDisplayName = selectedServer ? resolveFrontendLocalizedText(selectedServer.displayName, locale) : "";
  const selectedDescription = selectedServer ? resolveFrontendLocalizedText(selectedServer.description, locale) : "";
  const pendingChanges = Object.keys(drafts).length > 0;
  const syncing = syncRequest !== null;
  const connected = systemConfig?.socketStatus === "open";

  useEffect(() => {
    // MCP changes are sent automatically; the settings shell must not open a
    // second save flow or block navigation for a transient local draft.
    onDirtyChange?.(false);
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  useEffect(() => {
    if (servers.length === 0) {
      setSelectedServerId(null);
      setDrafts({});
      setSyncRequest(null);
      return;
    }
    if (selectedServerId && !servers.some((server) => server.id === selectedServerId)) {
      setSelectedServerId(null);
      setDrafts({});
      setSyncRequest(null);
      setOperationError(null);
    }
  }, [selectedServerId, servers]);

  useEffect(() => {
    if (!syncRequest || systemConfig?.mcpInputOperation?.requestId !== syncRequest.requestId) return;
    const request = syncRequest;
    const requestServer = servers.find((server) => server.id === request.serverId);
    const isCurrentServer = selectedServer?.id === request.serverId;
    if (systemConfig.mcpInputOperation.status === "success") {
      if (isCurrentServer) {
        setDrafts((current) => reconcileMcpDrafts(current, request, requestServer, "success"));
      }
      setSyncRequest(null);
      setOperationError(null);
    } else if (systemConfig.mcpInputOperation.status === "error") {
      if (isCurrentServer) {
        setDrafts((current) => reconcileMcpDrafts(current, request, requestServer, "error"));
        setOperationError(systemConfig.mcpInputOperation.message ?? frontendMessage("settings.mcp.saveFailed"));
      }
      setSyncRequest(null);
    }
  }, [selectedServer?.id, servers, syncRequest, systemConfig?.mcpInputOperation]);

  useEffect(() => {
    if (connected || !syncRequest) return;
    const request = syncRequest;
    const requestServer = servers.find((server) => server.id === request.serverId);
    if (selectedServer?.id === request.serverId) {
      setDrafts((current) => reconcileMcpDrafts(current, request, requestServer, "error"));
      setOperationError(frontendMessage("settings.mcp.saveFailed"));
    }
    setSyncRequest(null);
  }, [connected, selectedServer?.id, servers, syncRequest]);

  useEffect(() => {
    if (!selectedServer || !pendingChanges || syncing || !connected) return;
    const timer = window.setTimeout(() => {
      const mutation = readMcpInputMutation(selectedServer, drafts);
      if (mutation.error) {
        setOperationError(mutation.error);
        return;
      }
      const values = mutation.values;
      if (!values) return;
      const requestId = systemConfig?.updateMcpInputs(selectedServer.id, values, []);
      if (!requestId) {
        setOperationError(frontendMessage("settings.mcp.commandUnavailable"));
        return;
      }
      setSyncRequest({
        requestId,
        serverId: selectedServer.id,
        values,
      });
      // Clear only the exact Secret value that crossed the transport boundary.
      // A newer keystroke must survive the response for this request.
      setDrafts((current) => removeSentSecretDrafts(current, values, selectedServer));
      setOperationError(null);
    }, McpInputSyncDebounceMs);
    return () => window.clearTimeout(timer);
  }, [connected, drafts, pendingChanges, selectedServer, syncing, systemConfig]);

  if (!systemConfig || !systemConfig.toolSettingsSynced.mcpServers) {
    return <StateView status="loading" description={frontendMessage("settings.mcp.loading")} />;
  }

  const selectServer = (serverId: string): void => {
    if (pendingChanges) return;
    setSelectedServerId(serverId);
    setDrafts({});
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
    setOperationError(null);
  };
  const restartServer = (): void => {
    if (!selectedServer || systemConfig.restartMcpServer(selectedServer.id)) {
      setOperationError(null);
      return;
    }
    setOperationError(frontendMessage("settings.mcp.commandUnavailable"));
  };

  const refreshButton = (
    <IconButton
      label={frontendMessage("settings.mcp.refresh")}
      tooltip={frontendMessage("settings.mcp.refresh")}
      size="sm"
      tone="muted"
      disabled={!connected || syncing}
      onClick={systemConfig.refreshToolSettings}
    >
      <ArrowPathIcon className="h-4 w-4" />
    </IconButton>
  );

  if (!selectedServer) {
    return (
      <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas" data-mcp-directory>
        <div className="mx-auto flex w-full max-w-[980px] shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4 lg:px-8">
          <div>
            <div className="text-[13px] font-semibold text-content-primary">
              {frontendMessage("settings.mcp.count", { count: servers.length })}
            </div>
            <p className="mt-1 text-[11px] text-content-muted">
              {frontendMessage("settings.mcp.directoryDescription")}
            </p>
          </div>
          {refreshButton}
        </div>
        {servers.length === 0 ? (
          <StateView
            status="empty"
            icon={<ServerStackIcon className="h-4 w-4 text-ink-400" />}
            title={frontendMessage("settings.mcp.empty")}
          />
        ) : (
          <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
            <div className="mx-auto w-full max-w-[980px] px-6 lg:px-8">
              {servers.map((server) => (
                <McpServerRow
                  key={server.id}
                  server={server}
                  locale={locale}
                  directory
                  selected={false}
                  disabled={pendingChanges || syncing}
                  onSelect={() => selectServer(server.id)}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas" data-mcp-detail>
      <div className="mx-auto flex w-full max-w-[980px] shrink-0 flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-4 lg:px-8">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-content-muted transition hover:bg-surface-hover hover:text-content-primary"
            aria-label={frontendMessage("settings.mcp.backToServers")}
            onClick={() => setSelectedServerId(null)}
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <ServerStackIcon className="mt-1 h-6 w-6 shrink-0 text-accent-content" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <h3 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-content-primary">
                {selectedDisplayName}
              </h3>
              <McpStatus status={selectedServer.status} />
            </div>
            <p className="mt-1 text-[12px] leading-5 text-content-secondary">{selectedDescription}</p>
            <p className="mt-2 text-[10.5px] text-content-muted">
              {frontendMessage(`settings.mcp.source.${selectedServer.source}`)} ·{" "}
              {selectedServer.transport.toUpperCase()}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {syncing ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-500" aria-live="polite">
              <Spinner size="xs" className="text-accent-content" />
              {frontendMessage("settings.mcp.saving")}
            </span>
          ) : null}
          <Button variant="outline" size="sm" disabled={!connected || syncing} onClick={restartServer}>
            <ArrowPathRoundedSquareIcon className="h-3.5 w-3.5" />
            {frontendMessage("settings.mcp.restart")}
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {operationError ? (
          <InlineError className="mx-auto mt-4 max-w-[980px] px-6 lg:px-8">{operationError}</InlineError>
        ) : null}
        <div className="mx-auto w-full max-w-[900px] px-6 py-6 lg:px-8">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div className="text-[13px] font-semibold text-content-primary">
              {frontendMessage("settings.mcp.inputs")}
            </div>
            <span className="text-[11px] text-content-muted">{selectedServer.inputs.length}</span>
          </div>
          {selectedServer.inputs.length === 0 ? (
            <div className="border-y border-ink-200/70 py-8 text-center text-[12px] text-ink-500">
              {frontendMessage("settings.mcp.noInputs")}
            </div>
          ) : (
            <div className="divide-y divide-line border-y border-line">
              {selectedServer.inputs.map((input) => {
                const value = drafts[input.id] ?? input.value ?? input.defaultValue ?? "";
                return (
                  <div
                    key={input.id}
                    className="grid gap-3 py-3.5 lg:grid-cols-[minmax(190px,0.5fr)_minmax(260px,1fr)] lg:gap-6"
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
                      {shouldShowInputSource(input.source) ? (
                        <div className="mt-1 text-[11px] leading-4 text-ink-500">
                          {frontendMessage(`settings.mcp.inputSource.${input.source}`)}
                        </div>
                      ) : null}
                    </div>
                    <FormField className="min-w-0 gap-1.5">
                      <FormLabel className="sr-only">{input.title}</FormLabel>
                      <McpInputControl
                        input={input}
                        value={value}
                        disabled={!connected}
                        onChange={(next) => updateDraft(input, next)}
                      />
                      {input.description ? <FormHint>{input.description}</FormHint> : null}
                    </FormField>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
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
  const Icon: ElementType<{ className?: string }> = input.secret
    ? KeyIcon
    : input.type === "filepath" || input.type === "directory"
      ? FolderIcon
      : AdjustmentsHorizontalIcon;
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

function readMcpInputMutation(
  server: McpServerSettingsItem,
  drafts: Record<string, McpInputDraft>,
): { values?: Record<string, McpInputValue>; error?: string } {
  try {
    const values: Record<string, McpInputValue> = {};
    for (const input of server.inputs) {
      if (!(input.id in drafts)) continue;
      const draft = drafts[input.id];
      if (input.secret && draft === "") continue;
      const value = normalizeDraft(input, draft ?? "");
      if (input.required && isEmptyValue(value)) {
        throw new InputValidationError(frontendMessage("settings.mcp.inputValueRequired", { name: input.title }));
      }
      values[input.id] = value;
    }
    return { values: Object.keys(values).length > 0 ? values : undefined };
  } catch (error) {
    return {
      error:
        error instanceof InputValidationError
          ? error.message
          : frontendMessage("settings.mcp.inputValueInvalid", { name: server.id }),
    };
  }
}

function removeSentSecretDrafts(
  drafts: Record<string, McpInputDraft>,
  values: Readonly<Record<string, McpInputValue>>,
  server: McpServerSettingsItem,
): Record<string, McpInputDraft> {
  const next = { ...drafts };
  for (const input of server.inputs) {
    if (!input.secret || !(input.id in values) || !(input.id in next)) continue;
    if (sameDraft(next[input.id], values[input.id])) delete next[input.id];
  }
  return next;
}

function reconcileMcpDrafts(
  drafts: Record<string, McpInputDraft>,
  request: McpSyncRequest,
  server: McpServerSettingsItem | undefined,
  outcome: "success" | "error",
): Record<string, McpInputDraft> {
  const next = { ...drafts };
  for (const [inputId, value] of Object.entries(request.values)) {
    if (outcome === "success") {
      if (inputId in next && sameDraft(next[inputId], value)) delete next[inputId];
      continue;
    }
    const input = server?.inputs.find((candidate) => candidate.id === inputId);
    if (input?.secret && !(inputId in next)) next[inputId] = value;
  }
  return next;
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
  locale,
  directory = false,
  selected,
  disabled,
  onSelect,
}: {
  server: McpServerSettingsItem;
  locale: import("../../../i18n/frontendLocaleModel").FrontendLocale;
  directory?: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        directory
          ? "flex min-h-[68px] w-full min-w-0 items-center gap-3 border-b border-line px-1 py-3 text-left transition-colors"
          : "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
        !directory && selected
          ? "bg-accent-surface text-accent-content"
          : "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
        disabled && "cursor-not-allowed opacity-50",
      )}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <ServerStackIcon className="h-5 w-5 shrink-0 text-content-secondary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold">
          {resolveFrontendLocalizedText(server.displayName, locale)}
        </span>
        {directory ? (
          <span className="mt-0.5 block truncate text-[10.5px] text-content-muted">
            {shortenMcpDescription(resolveFrontendLocalizedText(server.description, locale))}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 text-[10.5px]",
          server.status === "configured" ? "text-accent-content" : "text-umber-600",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            server.status === "configured" ? "bg-accent-solid" : "bg-umber-500",
          )}
        />
        {frontendMessage(`settings.mcp.status.${server.status}`)}
      </span>
      {server.status === "needs_input" && !directory ? (
        <PauseCircleIcon
          className="h-4 w-4 shrink-0 text-umber-600"
          aria-label={frontendMessage(`settings.mcp.status.${server.status}`)}
        />
      ) : null}
    </button>
  );
}

function shortenMcpDescription(value: string): string {
  const text = value.trim().replace(/[.!?。！？]+$/u, "");
  if (!text) return "";
  return `${text.length > 88 ? text.slice(0, 88).trimEnd() : text}…`;
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

function shouldShowInputSource(source: McpInputStatus["source"]): boolean {
  return source === "vault" || source === "environment" || source === "oauth";
}
