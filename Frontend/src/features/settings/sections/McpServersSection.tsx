import { useCallback, useEffect, useRef, useState, type ElementType, type KeyboardEvent } from "react";
import AdjustmentsHorizontalIcon from "@heroicons/react/24/outline/AdjustmentsHorizontalIcon";
import ArrowLeftIcon from "@heroicons/react/24/outline/ArrowLeftIcon";
import ArrowPathIcon from "@heroicons/react/24/outline/ArrowPathIcon";
import ArrowPathRoundedSquareIcon from "@heroicons/react/24/outline/ArrowPathRoundedSquareIcon";
import FolderIcon from "@heroicons/react/24/outline/FolderIcon";
import PauseCircleIcon from "@heroicons/react/24/outline/PauseCircleIcon";
import ServerStackIcon from "@heroicons/react/24/outline/ServerStackIcon";
import type { McpInputStatus, McpInputValue, McpServerSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { cn } from "../../../lib/util";
import { FluidHoverHighlight, useFluidHover, useMotionLevel } from "../../../shared/motion";
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
  SecretInput,
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
  deletes: readonly string[];
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
  // Secrets stay write-only end to end; this only echoes what the user saved in
  // the current view so the field does not blank itself right after saving.
  const [savedSecrets, setSavedSecrets] = useState<Record<string, string>>({});
  const [activeRequests, setActiveRequests] = useState<readonly McpSyncRequest[]>([]);
  const [operationError, setOperationError] = useState<string | null>(null);
  const locale = useFrontendLocale();
  const { disableMotion } = useMotionLevel();
  const serverListRef = useRef<HTMLDivElement>(null);
  const serverHover = useFluidHover(serverListRef, {
    axis: "y",
    isItemDisabled: (element) => element.hasAttribute("disabled"),
  });
  const servers = systemConfig?.mcpServers ?? EmptyMcpServers;
  const selectedServer = selectedServerId ? (servers.find((server) => server.id === selectedServerId) ?? null) : null;
  const selectedDisplayName = selectedServer ? resolveFrontendLocalizedText(selectedServer.displayName, locale) : "";
  const selectedDescription = selectedServer ? resolveFrontendLocalizedText(selectedServer.description, locale) : "";
  const unavailableCapabilityDetails: readonly { id: string; reason?: string }[] = selectedServer
    ? (selectedServer.unavailableCapabilityDetails ??
      selectedServer.unavailableCapabilities?.map((id) => ({ id })) ??
      [])
    : [];
  const pendingChanges = Object.keys(drafts).length > 0;
  const syncing = activeRequests.length > 0;
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
      setSavedSecrets({});
      setActiveRequests([]);
      return;
    }
    if (selectedServerId && !servers.some((server) => server.id === selectedServerId)) {
      setSelectedServerId(null);
      setDrafts({});
      setSavedSecrets({});
      setActiveRequests([]);
      setOperationError(null);
    }
  }, [selectedServerId, servers]);

  const sendMcpMutation = useCallback(
    (serverId: string, values: Record<string, McpInputValue>, deletes: readonly string[]): boolean => {
      const requestId = systemConfig?.updateMcpInputs(serverId, values, [...deletes]);
      if (!requestId) {
        setOperationError(frontendMessage("settings.mcp.commandUnavailable"));
        return false;
      }
      setActiveRequests((current) => [...current, { requestId, serverId, values, deletes }]);
      setOperationError(null);
      return true;
    },
    [systemConfig],
  );

  // Secrets commit on blur/Enter; plain values also flush here so leaving a
  // field or the page never loses an edit. An identical in-flight request is
  // not sent twice.
  const sendDrafts = useCallback((): boolean => {
    if (!selectedServer || !connected || !pendingChanges) return true;
    const mutation = readMcpInputMutation(selectedServer, drafts);
    if (mutation.error) {
      setOperationError(mutation.error);
      return false;
    }
    if (!mutation.values) return true;
    const duplicate = activeRequests.some(
      (request) =>
        request.serverId === selectedServer.id &&
        request.deletes.length === 0 &&
        JSON.stringify(request.values) === JSON.stringify(mutation.values),
    );
    if (duplicate) return true;
    return sendMcpMutation(selectedServer.id, mutation.values, []);
  }, [activeRequests, connected, drafts, pendingChanges, selectedServer, sendMcpMutation]);

  useEffect(() => {
    const operation = systemConfig?.mcpInputOperation;
    if (!operation) return;
    const request = activeRequests.find((entry) => entry.requestId === operation.requestId);
    if (!request) return;
    const requestServer = servers.find((server) => server.id === request.serverId);
    const isCurrentServer = selectedServer?.id === request.serverId;
    setActiveRequests((current) => current.filter((entry) => entry.requestId !== operation.requestId));
    if (operation.status === "success") {
      if (isCurrentServer) {
        setDrafts((current) => reconcileMcpDrafts(current, request, requestServer, "success"));
        setSavedSecrets((current) => applySavedSecrets(current, request, requestServer));
      }
      setOperationError(null);
    } else if (isCurrentServer) {
      setDrafts((current) => reconcileMcpDrafts(current, request, requestServer, "error"));
      setOperationError(operation.message ?? frontendMessage("settings.mcp.saveFailed"));
    }
  }, [activeRequests, selectedServer?.id, servers, systemConfig?.mcpInputOperation]);

  useEffect(() => {
    if (connected || activeRequests.length === 0) return;
    const affected = activeRequests.filter((request) => request.serverId === selectedServer?.id);
    if (affected.length > 0) {
      setDrafts((current) => {
        let next = current;
        for (const request of affected) {
          const requestServer = servers.find((server) => server.id === request.serverId);
          next = reconcileMcpDrafts(next, request, requestServer, "error");
        }
        return next;
      });
      setOperationError(frontendMessage("settings.mcp.saveFailed"));
    }
    // The socket dropped; responses for in-flight mutations may never arrive.
    setActiveRequests([]);
  }, [activeRequests, connected, selectedServer?.id, servers]);

  useEffect(() => {
    if (!selectedServer || selectedServer.status === "unavailable" || !pendingChanges || syncing || !connected) return;
    // Secret drafts commit on blur/Enter instead of per keystroke, so a
    // partially typed key is never written to the vault.
    const hasAutoSyncDraft = selectedServer.inputs.some((input) => !input.secret && input.id in drafts);
    if (!hasAutoSyncDraft) return;
    const timer = window.setTimeout(() => {
      void sendDrafts();
    }, McpInputSyncDebounceMs);
    return () => window.clearTimeout(timer);
  }, [connected, drafts, pendingChanges, selectedServer, sendDrafts, syncing]);

  if (!systemConfig || !systemConfig.toolSettingsSynced.mcpServers) {
    return <StateView status="loading" description={frontendMessage("settings.mcp.loading")} />;
  }

  const resetServerView = (): void => {
    setDrafts({});
    setSavedSecrets({});
    setOperationError(null);
  };
  const leaveServerDetail = (): void => {
    if (!sendDrafts()) return;
    setSelectedServerId(null);
    resetServerView();
  };
  const selectServer = (serverId: string): void => {
    if (!sendDrafts()) return;
    setSelectedServerId(serverId);
    resetServerView();
  };
  const clearSecret = (input: McpInputStatus): void => {
    if (!selectedServer) return;
    setDrafts((current) => {
      if (!(input.id in current)) return current;
      const next = { ...current };
      delete next[input.id];
      return next;
    });
    sendMcpMutation(selectedServer.id, {}, [input.id]);
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
            <div
              ref={serverListRef}
              className="relative mx-auto w-full max-w-[980px] px-6 lg:px-8"
              {...serverHover.handlers}
            >
              <FluidHoverHighlight hover={serverHover} hidden={disableMotion} className="rounded-md" />
              {servers.map((server, index) => (
                <McpServerRow
                  key={server.id}
                  itemRef={serverHover.getItemRef(index)}
                  fluidHoverEnabled={!disableMotion}
                  server={server}
                  locale={locale}
                  directory
                  selected={false}
                  disabled={!connected}
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
            onClick={leaveServerDetail}
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
          <Button
            variant="outline"
            size="sm"
            disabled={!connected || syncing || selectedServer.status === "unavailable"}
            onClick={restartServer}
          >
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
          {selectedServer.status === "unavailable" ? (
            <div className="mb-5 border-y border-line py-3 text-[12px] leading-5 text-content-secondary" role="status">
              <p>{frontendMessage("settings.mcp.unavailableDescription")}</p>
              {unavailableCapabilityDetails.length ? (
                <div className="mt-2">
                  <div className="text-[11px] font-semibold text-content-primary">
                    {frontendMessage("settings.mcp.unavailableCapabilities")}
                  </div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {unavailableCapabilityDetails.map((capability) => (
                      <li key={capability.id}>
                        <code className="font-mono text-[11px] text-content-primary">{capability.id}</code>
                        {capability.reason ? <span className="ml-1">{capability.reason}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
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
                const draft = drafts[input.id];
                const value = readInputDisplayValue(input, draft, savedSecrets[input.id]);
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
                        disabled={!connected || selectedServer.status === "unavailable"}
                        secretReplaced={input.secret && input.configured}
                        clearable={input.secret && input.stored && draft === undefined}
                        onChange={(next) => updateDraft(input, next)}
                        onCommit={sendDrafts}
                        onClear={() => clearSecret(input)}
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
  secretReplaced,
  clearable,
  onChange,
  onCommit,
  onClear,
}: {
  input: McpInputStatus;
  value: McpInputDraft;
  disabled: boolean;
  secretReplaced: boolean;
  clearable: boolean;
  onChange: (value: McpInputDraft) => void;
  onCommit: () => void;
  onClear: () => void;
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
  const secret = input.secret;
  if (secret) {
    return (
      <SecretInput
        value={String(formatDraftValue(value))}
        disabled={disabled}
        placeholder={
          secretReplaced
            ? frontendMessage("settings.mcp.secretReplacePlaceholder")
            : (input.placeholder ?? frontendMessage("settings.mcp.inputPlaceholder"))
        }
        ariaLabel={input.title}
        className="h-9 pl-9 text-[12.5px] font-mono tracking-tight"
        showClearButton={clearable}
        clearButtonLabel={frontendMessage("settings.mcp.clearSecret")}
        onChange={(next) => onChange(next)}
        onBlur={onCommit}
        onClear={onClear}
      />
    );
  }
  const Icon: ElementType<{ className?: string }> =
    input.type === "filepath" || input.type === "directory" ? FolderIcon : AdjustmentsHorizontalIcon;
  return (
    <div className="relative min-w-0">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-350" />
      <Input
        type={input.type === "number" ? "number" : "text"}
        autoComplete="off"
        spellCheck={false}
        min={input.min}
        max={input.max}
        value={formatDraftValue(value)}
        disabled={disabled}
        placeholder={input.placeholder ?? frontendMessage("settings.mcp.inputPlaceholder")}
        aria-label={input.title}
        className="h-9 rounded-md pl-9 text-[12.5px]"
        onBlur={onCommit}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") onCommit();
        }}
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

function readInputDisplayValue(
  input: McpInputStatus,
  draft: McpInputDraft | undefined,
  savedSecret: string | undefined,
): McpInputDraft {
  if (draft !== undefined) return draft;
  if (input.secret) {
    // Stored secrets are write-only; echo what the user saved during this
    // view, otherwise show nothing rather than a misleading default.
    return savedSecret ?? (input.configured ? "" : (input.defaultValue ?? ""));
  }
  return input.value ?? input.defaultValue ?? "";
}

function applySavedSecrets(
  saved: Record<string, string>,
  request: McpSyncRequest,
  server: McpServerSettingsItem | undefined,
): Record<string, string> {
  const next = { ...saved };
  for (const inputId of request.deletes) delete next[inputId];
  for (const [inputId, value] of Object.entries(request.values)) {
    const input = server?.inputs.find((candidate) => candidate.id === inputId);
    if (input?.secret && typeof value === "string") next[inputId] = value;
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
  itemRef,
  fluidHoverEnabled,
  server,
  locale,
  directory = false,
  selected,
  disabled,
  onSelect,
}: {
  itemRef?: (element: HTMLElement | null) => void;
  fluidHoverEnabled?: boolean;
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
      ref={itemRef}
      disabled={disabled}
      className={cn(
        directory
          ? "flex min-h-[68px] w-full min-w-0 items-center gap-3 border-b border-line px-1 py-3 text-left transition-colors"
          : "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
        !directory && selected
          ? "bg-accent-surface text-accent-content"
          : cn(
              "text-content-secondary hover:text-content-primary",
              fluidHoverEnabled ? "hover:bg-transparent" : "hover:bg-surface-hover",
            ),
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
