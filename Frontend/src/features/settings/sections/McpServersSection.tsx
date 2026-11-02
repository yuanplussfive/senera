import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { McpInputStatus, McpInputValue, McpServerSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { cn } from "../../../lib/util";
import { classifySettingsContentLayout, useObservedLayout } from "../../../shared/responsive";
import {
  AppIcon,
  DurationInput,
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
  StatusToken,
  Switch,
} from "../../../shared/ui";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import { SettingsSectionLoading } from "../SettingsLoading";
import { SettingsEntityNavigator } from "./SettingsEntityNavigator";
import { SettingsEntityMetrics } from "./SettingsEntityMetrics";
import { PluginIdentityFrame, PluginIdentityIcon, PluginIdentityTile } from "./PluginIdentityIcon";
import { PluginUsageExamples } from "./PluginUsageExamples";
import { PluginDocumentation } from "./PluginDocumentation";
import {
  readConfiguredModelNameOptions,
  readConfiguredModelConnectionOptions,
} from "../systemExtensionConfigurationPresentation";
import { PluginSkills } from "./PluginSkills";
import { ModelSelect } from "../../../shared/models/ModelSelect";

import {
  readMcpInputMutation,
  readInputDisplayValue,
  applySavedSecrets,
  reconcileMcpDrafts,
  parseMultipleChoiceValues,
  formatDraftValue,
  formatInputValue,
  sameDraft,
  type McpInputDraft,
  type McpSyncRequest,
} from "./mcpInputDraft";

const EmptyMcpServers: readonly McpServerSettingsItem[] = [];
const McpInputSyncDebounceMs = 350;
type McpStatusFilter = "all" | McpServerSettingsItem["status"];

export function McpServersSection({
  systemConfig,
  onDirtyChange,
  detailServerId,
  activationControl,
}: {
  systemConfig?: SettingsSystemConfigHandle;
  onDirtyChange?: (dirty: boolean) => void;
  /** Renders one server inside a parent-owned settings detail view. */
  detailServerId?: string;
  /** Parent-owned config draft control for the unified plugin directory. */
  activationControl?: {
    readonly enabled: boolean;
    readonly disabled: boolean;
    readonly onEnabledChange: (enabled: boolean) => void;
  };
}): JSX.Element {
  const [selectedServerId, setSelectedServerId] = useState<string | null>(() => detailServerId ?? null);
  const [drafts, setDrafts] = useState<Record<string, McpInputDraft>>({});
  // Secrets stay write-only end to end; this only echoes what the user saved in
  // the current view so the field does not blank itself right after saving.
  const [savedSecrets, setSavedSecrets] = useState<Record<string, string>>({});
  const [activeRequests, setActiveRequests] = useState<readonly McpSyncRequest[]>([]);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<McpStatusFilter>("all");
  const locale = useFrontendLocale();
  const { ref: layoutRef, layout } = useObservedLayout<HTMLDivElement, "compact" | "standard" | "wide">(
    classifySettingsContentLayout,
    "standard",
  );
  const servers = systemConfig?.mcpServers ?? EmptyMcpServers;
  const effectiveSelectedServerId = detailServerId ?? selectedServerId;
  const selectedServer = effectiveSelectedServerId
    ? (servers.find((server) => server.id === effectiveSelectedServerId) ?? null)
    : null;
  const selectedDisplayName = selectedServer ? resolveFrontendLocalizedText(selectedServer.displayName, locale) : "";
  const selectedDescription = selectedServer ? resolveFrontendLocalizedText(selectedServer.description, locale) : "";
  const unavailableCapabilityDetails = selectedServer?.unavailableCapabilityDetails ?? [];
  const pendingChanges = Object.keys(drafts).length > 0;
  const syncing = activeRequests.length > 0;
  const connected = systemConfig?.socketStatus === "open";
  const connectedRef = useRef(connected);
  const workspaceId = systemConfig?.workspaceId ?? null;
  const workspaceIdRef = useRef(workspaceId);
  const reconnecting = !connected && syncing;
  const visibleServers = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase(locale);
    return servers.filter((server) => {
      if (statusFilter !== "all" && server.status !== statusFilter) return false;
      if (!normalizedSearch) return true;
      return [
        resolveFrontendLocalizedText(server.displayName, locale),
        resolveFrontendLocalizedText(server.description, locale),
      ]
        .join(" ")
        .toLocaleLowerCase(locale)
        .includes(normalizedSearch);
    });
  }, [locale, search, servers, statusFilter]);
  const sourceGroups = useMemo(() => projectMcpServerSourceGroups(visibleServers, locale), [locale, visibleServers]);

  useEffect(() => {
    if (workspaceIdRef.current === workspaceId) return;
    workspaceIdRef.current = workspaceId;
    setSelectedServerId(null);
    setDrafts({});
    setSavedSecrets({});
    setActiveRequests([]);
    setOperationError(null);
    setMobileDetailOpen(false);
  }, [workspaceId]);

  useEffect(() => {
    // MCP changes are sent automatically; the settings shell must not open a
    // second save flow or block navigation for a transient local draft.
    onDirtyChange?.(false);
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  useEffect(() => {
    if (detailServerId !== undefined || servers.length === 0) {
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
      setMobileDetailOpen(false);
    }
  }, [detailServerId, selectedServerId, servers]);

  useEffect(() => {
    if (detailServerId !== undefined || servers.length === 0) return;
    if (selectedServerId && servers.some((server) => server.id === selectedServerId)) return;
    if (layout !== "compact") setSelectedServerId(servers[0].id);
  }, [detailServerId, layout, selectedServerId, servers]);

  useEffect(() => {
    if (layout === "compact") setMobileDetailOpen(false);
  }, [layout]);

  const sendMcpMutation = useCallback(
    (serverId: string, values: Record<string, McpInputValue>, deletes: readonly string[]): boolean => {
      const requestId = systemConfig?.updateMcpInputs(serverId, values, [...deletes]);
      if (!requestId) {
        setOperationError(frontendMessage("settings.mcp.commandUnavailable"));
        return false;
      }
      setActiveRequests((current) => [
        ...current,
        { requestId, serverId, values: { ...values }, deletes: [...deletes] },
      ]);
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
    if (!operation || operation.status === "pending") return;
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
    const wasConnected = connectedRef.current;
    connectedRef.current = connected;
    if (!connected || wasConnected || activeRequests.length === 0) return;

    // A close only removes the response path; it does not prove that an
    // idempotent update was rejected. Re-submit the exact mutation after the
    // new connection opens and wait for its authoritative snapshot.
    const retried = activeRequests.map((request) => {
      const requestId = systemConfig?.updateMcpInputs(request.serverId, request.values, [...request.deletes]);
      return requestId ? { ...request, requestId } : request;
    });
    setActiveRequests(retried);
    if (retried.some((request, index) => request.requestId === activeRequests[index]?.requestId)) {
      setOperationError(frontendMessage("settings.mcp.commandUnavailable"));
    } else {
      setOperationError(null);
    }
  }, [activeRequests, connected, systemConfig]);

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
    return <SettingsSectionLoading variant={detailServerId ? "form" : "split"} />;
  }

  const resetServerView = (): void => {
    setDrafts({});
    setSavedSecrets({});
    setOperationError(null);
  };
  const leaveServerDetail = (): void => {
    if (!sendDrafts()) return;
    setMobileDetailOpen(false);
  };
  const selectServer = (serverId: string): void => {
    if (!sendDrafts()) return;
    setSelectedServerId(serverId);
    resetServerView();
    if (layout === "compact") setMobileDetailOpen(true);
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
      <AppIcon icon="refresh" size={16} />
    </IconButton>
  );

  const filterOptions = [
    { value: "all", label: frontendMessage("settings.entityNavigator.all") },
    ...(["configured", "needs_input", "unavailable"] as const).map((status) => ({
      value: status,
      label: frontendMessage(`settings.mcp.status.${status}`),
    })),
  ];
  const navigator = (
    <SettingsEntityNavigator
      title={frontendMessage("settings.mcp.count", { count: servers.length })}
      summary={frontendMessage("settings.mcp.navigatorSummary", {
        configured: servers.filter((server) => server.status === "configured").length,
      })}
      groups={sourceGroups}
      search={search}
      searchPlaceholder={frontendMessage("settings.mcp.search")}
      clearSearchLabel={frontendMessage("settings.entityNavigator.clearSearch")}
      filterLabel={frontendMessage("settings.entityNavigator.filter")}
      filterValue={statusFilter}
      filterOptions={filterOptions}
      emptyMessage={
        servers.length === 0
          ? frontendMessage("settings.mcp.empty")
          : frontendMessage("settings.entityNavigator.noMatches")
      }
      refreshAction={refreshButton}
      getItemKey={(server) => server.id}
      selectedItemKey={selectedServer?.id}
      renderItem={(server, { fluidHoverEnabled }) => (
        <McpNavigatorRow
          server={server}
          locale={locale}
          selected={selectedServer?.id === server.id}
          fluidHoverEnabled={fluidHoverEnabled}
          disabled={!connected}
          onSelect={() => selectServer(server.id)}
        />
      )}
      onSearchChange={setSearch}
      onFilterChange={(value) => setStatusFilter(value as McpStatusFilter)}
    />
  );
  const detail = selectedServer ? (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas">
      <header className="shrink-0 px-5 pt-5 sm:px-8">
        <div className="mx-auto flex w-full max-w-[860px] flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <PluginIdentityTile className="mt-0.5">
              <PluginIdentityIcon
                brandIcon={selectedServer.presentation?.brandIcon}
                icon={selectedServer.presentation?.icon}
                size={28}
              />
            </PluginIdentityTile>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="text-[18px] font-semibold leading-7 tracking-[-0.02em] text-content-strong">
                  {selectedDisplayName}
                </h3>
                <McpStatus status={selectedServer.status} />
              </div>
              <p className="mt-1 max-w-[64ch] text-[13px] leading-6 text-content-secondary">{selectedDescription}</p>
            </div>
          </div>
          <div className="flex min-h-8 shrink-0 items-center gap-2">
            {syncing ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-content-muted" aria-live="polite">
                <Spinner size="xs" className="text-accent-content" />
                {frontendMessage(reconnecting ? "settings.mcp.unsaved" : "settings.mcp.saving")}
              </span>
            ) : null}
            {activationControl ? (
              <Switch
                checked={activationControl.enabled}
                size="sm"
                disabled={activationControl.disabled}
                ariaLabel={frontendMessage("settings.mcp.enableServer", { name: selectedDisplayName })}
                onCheckedChange={activationControl.onEnabledChange}
              />
            ) : null}
            <IconButton
              label={frontendMessage("settings.mcp.restart")}
              tooltip={frontendMessage("settings.mcp.restart")}
              tone="muted"
              size="sm"
              disabled={!connected || syncing || selectedServer.status === "unavailable"}
              onClick={restartServer}
            >
              <AppIcon icon="refresh" size={14} />
            </IconButton>
          </div>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {operationError ? (
          <InlineError className="mx-auto mt-4 max-w-[860px] px-6 sm:px-8">{operationError}</InlineError>
        ) : null}
        <div className="mx-auto w-full max-w-[924px] px-5 py-5 sm:px-8">
          <PluginDocumentation content={selectedServer.presentation?.documentation} />
          <PluginUsageExamples examples={selectedServer.presentation?.usageExamples} />
          <PluginSkills skills={selectedServer.skills ?? []} />
          <SettingsEntityMetrics
            dataTestId="mcp-metrics"
            items={[
              {
                label: frontendMessage("settings.entitySummary.source"),
                value: frontendMessage(`settings.mcp.source.${selectedServer.source}`),
              },
              {
                label: frontendMessage("settings.entitySummary.transport"),
                value: selectedServer.transport.toUpperCase(),
              },
              { label: frontendMessage("settings.entitySummary.descriptor"), value: selectedServer.descriptorKind },
            ]}
          />
          {selectedServer.status === "unavailable" ? (
            <div
              className="mb-5 mt-7 border-y border-line py-3 text-[12px] leading-5 text-content-secondary"
              role="status"
            >
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
          <div className="mb-3 mt-7 flex items-baseline justify-between gap-3">
            <div className="text-[13px] font-semibold text-content-primary">
              {frontendMessage("settings.mcp.inputs")}
            </div>
            <span className="text-[11px] tabular-nums text-content-muted">{selectedServer.inputs.length}</span>
          </div>
          {selectedServer.inputs.length === 0 ? (
            <div className="border-y border-line py-8 text-center text-[12px] text-content-muted">
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
                        <span className="truncate text-[12px] font-semibold text-content-primary">{input.title}</span>
                        {input.required ? (
                          <span className="text-[10.5px] text-brick-600">
                            {frontendMessage("settings.mcp.required")}
                          </span>
                        ) : null}
                      </div>
                      {shouldShowInputSource(input.source) ? (
                        <div
                          className={cn(
                            "mt-1 text-[11px] leading-4",
                            input.source === "unresolved" ? "text-brick-600" : "text-content-muted",
                          )}
                        >
                          {frontendMessage(`settings.mcp.inputSource.${input.source}`)}
                        </div>
                      ) : null}
                    </div>
                    <FormField className="min-w-0 gap-1.5">
                      <FormLabel className="sr-only">{input.title}</FormLabel>
                      <McpInputControl
                        modelOptions={
                          input.modelSelection?.valueKind === "model-connection"
                            ? readConfiguredModelConnectionOptions(
                                systemConfig?.configSnapshot ?? null,
                                input.modelSelection.capability,
                              )
                            : readConfiguredModelNameOptions(
                                systemConfig?.configSnapshot ?? null,
                                input.modelSelection?.capability,
                              )
                        }
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
  ) : (
    <StateView
      status="empty"
      className="min-h-[220px] bg-surface-canvas"
      icon={<AppIcon icon="server" size={18} className="text-content-muted" />}
      title={frontendMessage("settings.mcp.selectServer")}
    />
  );

  if (detailServerId !== undefined) {
    return (
      <div className="h-full min-h-0 overflow-hidden" data-mcp-detail>
        {detail}
      </div>
    );
  }

  return (
    <div ref={layoutRef} className="h-full min-h-0 overflow-hidden" data-mcp-layout={layout}>
      {layout === "compact" ? (
        mobileDetailOpen && selectedServer ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas" data-mcp-detail>
            <button
              type="button"
              className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line-subtle/70 px-3 text-left text-[12.5px] font-medium text-content-secondary transition hover:bg-surface-hover hover:text-content-primary"
              onClick={leaveServerDetail}
            >
              <AppIcon icon="chevron-right" size={16} className="rotate-180" aria-hidden="true" />
              {frontendMessage("settings.mcp.backToServers")}
            </button>
            <div className="min-h-0 flex-1 overflow-hidden">{detail}</div>
          </div>
        ) : (
          <div className="h-full min-h-0" data-mcp-directory>
            {navigator}
          </div>
        )
      ) : (
        <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)] overflow-hidden bg-surface-sidebar">
          <div className="h-full min-h-0 overflow-hidden" data-mcp-directory>
            {navigator}
          </div>
          <div className="h-full min-h-0 min-w-0 overflow-hidden" data-mcp-detail>
            {detail}
          </div>
        </div>
      )}
    </div>
  );
}

function McpInputControl({
  modelOptions,
  input,
  value,
  disabled,
  secretReplaced,
  clearable,
  onChange,
  onCommit,
  onClear,
}: {
  modelOptions: ReturnType<typeof readConfiguredModelNameOptions>;
  input: McpInputStatus;
  value: McpInputDraft;
  disabled: boolean;
  secretReplaced: boolean;
  clearable: boolean;
  onChange: (value: McpInputDraft) => void;
  onCommit: () => void;
  onClear: () => void;
}): JSX.Element {
  if (input.modelSelection)
    return (
      <ModelSelect
        allowCustom={input.modelSelection.valueKind === "model-name"}
        value={String(value)}
        options={modelOptions}
        placeholder={input.placeholder ?? frontendMessage("settings.mcp.inputPlaceholder")}
        ariaLabel={input.title}
        disabled={disabled}
        onChange={onChange}
        onBlur={onCommit}
      />
    );
  if (input.durationUnit)
    return (
      <DurationInput
        key={input.id}
        value={value === "" ? undefined : Number(value)}
        storageUnit={input.durationUnit}
        min={input.min}
        max={input.max}
        disabled={disabled}
        ariaLabel={input.title}
        onChange={(next) => onChange(next ?? "")}
        onBlur={onCommit}
      />
    );
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
        size="sm"
        disabled={disabled}
        placeholder={
          secretReplaced
            ? frontendMessage("settings.mcp.secretReplacePlaceholder")
            : (input.placeholder ?? frontendMessage("settings.mcp.inputPlaceholder"))
        }
        ariaLabel={input.title}
        className="text-[12.5px] font-mono tracking-tight"
        showClearButton={clearable}
        clearButtonLabel={frontendMessage("settings.mcp.clearSecret")}
        onChange={(next) => onChange(next)}
        onBlur={onCommit}
        onClear={onClear}
      />
    );
  }
  return (
    <Input
      type={input.type === "number" ? "number" : "text"}
      size="sm"
      autoComplete="off"
      spellCheck={false}
      min={input.min}
      max={input.max}
      value={formatDraftValue(value)}
      disabled={disabled}
      placeholder={input.placeholder ?? frontendMessage("settings.mcp.inputPlaceholder")}
      aria-label={input.title}
      onBlur={onCommit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") onCommit();
      }}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function McpNavigatorRow({
  server,
  locale,
  selected,
  fluidHoverEnabled,
  disabled,
  onSelect,
}: {
  server: McpServerSettingsItem;
  locale: import("../../../i18n/frontendLocaleModel").FrontendLocale;
  selected: boolean;
  fluidHoverEnabled: boolean;
  disabled: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
        selected
          ? "text-accent-content"
          : cn(
              "text-content-secondary hover:text-content-primary",
              fluidHoverEnabled ? "hover:bg-transparent" : "hover:bg-surface-hover",
            ),
        disabled && "cursor-not-allowed opacity-50",
      )}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <PluginIdentityFrame>
        <PluginIdentityIcon brandIcon={server.presentation?.brandIcon} icon={server.presentation?.icon} size={18} />
      </PluginIdentityFrame>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium">
          {resolveFrontendLocalizedText(server.displayName, locale)}
        </span>
        <StatusToken
          size="compact"
          className="mt-1 border border-line bg-surface-panel text-[9.5px] text-content-muted"
          data-mcp-preview
        >
          {server.inputs.length === 0
            ? frontendMessage("settings.entityPreview.noConfiguration")
            : frontendMessage("settings.entityPreview.configurationCount", { count: server.inputs.length })}
        </StatusToken>
      </span>
      <McpStatusToken status={server.status} />
    </button>
  );
}

const McpStatusTokenClassNames: Record<McpServerSettingsItem["status"], string> = {
  configured: "border-emerald-500/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  needs_input: "border-umber-500/50 bg-umber-500/5 text-umber-700 dark:text-umber-300",
  unavailable: "border-brick-500/50 bg-brick-500/5 text-brick-700 dark:text-brick-300",
};

function projectMcpServerSourceGroups(
  servers: readonly McpServerSettingsItem[],
  locale: import("../../../i18n/frontendLocaleModel").FrontendLocale,
): readonly { id: string; label: string; items: readonly McpServerSettingsItem[] }[] {
  const groups = new Map<McpServerSettingsItem["source"], McpServerSettingsItem[]>();
  for (const server of servers) {
    const group = groups.get(server.source);
    if (group) group.push(server);
    else groups.set(server.source, [server]);
  }
  return [...groups]
    .map(([source, items]) => ({
      id: source,
      label: frontendMessage(`settings.mcp.source.${source}`),
      items,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, locale));
}

function McpStatus({ status }: { status: McpServerSettingsItem["status"] }): JSX.Element {
  return <McpStatusToken status={status} />;
}

export function McpStatusToken({ status }: { status: McpServerSettingsItem["status"] }): JSX.Element {
  return (
    <StatusToken className={cn("border", McpStatusTokenClassNames[status])} data-mcp-status={status}>
      {frontendMessage(`settings.mcp.status.${status}`)}
    </StatusToken>
  );
}

function shouldShowInputSource(source: McpInputStatus["source"]): boolean {
  return source === "vault" || source === "environment" || source === "oauth" || source === "unresolved";
}
