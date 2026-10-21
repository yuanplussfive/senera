import { useEffect, useMemo, useState } from "react";
import type { SystemExtensionSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText, type FrontendLocale } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { cn } from "../../../lib/util";
import { classifySettingsContentLayout, useObservedLayout } from "../../../shared/responsive";
import { JsonConfigSettingsView } from "../../../shared/config/JsonConfigForm";
import { isJsonConfigObject } from "../../../shared/config/JsonConfigValue";
import {
  AppIcon,
  Dialog,
  DialogContent,
  IconButton,
  InlineError,
  ScrollArea,
  SegmentedControl,
  StateView,
  Switch,
} from "../../../shared/ui";
import { AgentToolPresentationIcon } from "../../../shared/workspace/AgentToolPresentationIcon";
import { AgentSystemExtensionSettingsSurfaces } from "../../../../../Source/AgentSystem/Types/AgentSystemExtensionSettingsSurface";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import { projectSystemExtensionConfigurationSections } from "../systemExtensionConfigurationPresentation";
import type { ConfigSettingsDraftState, ConfigDraftSaveMode } from "./configSettingsDraftState";
import { projectSectionConfigFields } from "./runtimeModelAssignments";
import { SettingsSectionLoading } from "../SettingsLoading";
import { SettingsEntityNavigator } from "./SettingsEntityNavigator";
import { SettingsEntityMetrics } from "./SettingsEntityMetrics";
import { SettingsBinaryStateToken } from "./SettingsBinaryStateToken";
import { PluginIdentityFrame, PluginIdentityIcon } from "./PluginIdentityIcon";

const EmptyExtensions: readonly SystemExtensionSettingsItem[] = [];
type ExtensionStatusFilter = "all" | "enabled" | "disabled";
type ExtensionDetailView = "contributions" | "configuration";

export function SystemToolsSection({
  draftState,
  systemConfig,
  detailExtensionId,
}: {
  draftState: ConfigSettingsDraftState;
  systemConfig?: SettingsSystemConfigHandle;
  /** Renders one extension inside a parent-owned settings detail view. */
  detailExtensionId?: string;
}): JSX.Element {
  const locale = useFrontendLocale();
  const { ref: layoutRef, layout } = useObservedLayout<HTMLDivElement, "compact" | "standard" | "wide">(
    classifySettingsContentLayout,
    "standard",
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => detailExtensionId ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [bulkManagerOpen, setBulkManagerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ExtensionStatusFilter>("all");
  const extensions = (systemConfig?.systemExtensions ?? EmptyExtensions).filter(
    (extension) => extension.settingsSurface === AgentSystemExtensionSettingsSurfaces.SystemTools,
  );
  const effectiveSelectedId = detailExtensionId ?? selectedId;
  const selected = effectiveSelectedId
    ? (extensions.find((extension) => extension.id === effectiveSelectedId) ?? null)
    : null;
  const selectedExtensionId = selected?.id;
  const selectedDraft = selected ? readExtensionDraft(draftState.draft, selected) : null;
  const enabled = selectedDraft?.enabled ?? true;
  const configuration = selectedDraft?.configuration ?? {};
  const connected = systemConfig?.socketStatus === "open";
  const visibleExtensions = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase(locale);
    return extensions.filter((extension) => {
      const draft = readExtensionDraft(draftState.draft, extension);
      const matchesStatus = statusFilter === "all" || (statusFilter === "enabled" ? draft.enabled : !draft.enabled);
      if (!matchesStatus) return false;
      if (!normalizedSearch) return true;
      const searchable = [
        resolveFrontendLocalizedText(extension.displayName, locale),
        resolveFrontendLocalizedText(extension.description, locale),
      ]
        .join(" ")
        .toLocaleLowerCase(locale);
      return searchable.includes(normalizedSearch);
    });
  }, [draftState.draft, extensions, locale, search, statusFilter]);
  const domainGroups = useMemo(() => projectSystemExtensionDirectoryGroups(visibleExtensions), [visibleExtensions]);
  const configurationSections = useMemo(
    () => projectVisibleExtensionConfigurationSections(selected, locale, systemConfig?.configSnapshot ?? null),
    [locale, selected, systemConfig?.configSnapshot],
  );
  const configurationFieldCounts = useMemo(
    () =>
      new Map(
        extensions.map((extension) => [
          extension.id,
          projectVisibleExtensionConfigurationSections(extension, locale, systemConfig?.configSnapshot ?? null).reduce(
            (count, section) => count + section.fields.length,
            0,
          ),
        ]),
      ),
    [extensions, locale, systemConfig?.configSnapshot],
  );
  const readSecret = useMemo(() => {
    if (!selectedExtensionId || !systemConfig) return undefined;
    const extensionId = selectedExtensionId;
    return (field: import("../../../api/eventTypes").ConfigFormFieldData): Promise<string> =>
      systemConfig.readExtensionSecret(extensionId, field.path);
  }, [selectedExtensionId, systemConfig]);

  useEffect(() => {
    if (detailExtensionId !== undefined || extensions.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && extensions.some((extension) => extension.id === selectedId)) return;
    if (layout !== "compact") setSelectedId(extensions[0].id);
  }, [detailExtensionId, extensions, layout, selectedId]);

  useEffect(() => {
    if (layout === "compact") setMobileDetailOpen(false);
  }, [layout]);

  if (!systemConfig || !systemConfig.toolSettingsSynced.systemTools) {
    return <SettingsSectionLoading variant="split" />;
  }

  const updateExtension = (
    nextEnabled: boolean,
    nextConfiguration: Record<string, unknown>,
    mode: ConfigDraftSaveMode,
  ): void => {
    if (!selected) return;
    draftState.updateDraft(writeExtensionDraft(draftState.draft, selected, nextEnabled, nextConfiguration), mode);
  };
  const toggleExtensionEnabled = (extension: SystemExtensionSettingsItem, nextEnabled: boolean): void => {
    const current = readExtensionDraft(draftState.draft, extension);
    draftState.updateDraft(
      writeExtensionDraft(draftState.draft, extension, nextEnabled, current.configuration),
      "immediate",
    );
  };
  const selectExtension = (extensionId: string): void => {
    setSelectedId(extensionId);
    if (layout === "compact") setMobileDetailOpen(true);
  };
  const refreshButton = (
    <IconButton
      label={frontendMessage("settings.tools.refresh")}
      tooltip={frontendMessage("settings.tools.refresh")}
      size="sm"
      tone="muted"
      disabled={!connected || draftState.saving}
      onClick={() => {
        systemConfig.refreshConfig();
        systemConfig.refreshToolSettings();
      }}
    >
      <AppIcon icon="refresh" size={16} aria-hidden="true" />
    </IconButton>
  );
  const manageExtensionsButton = (
    <IconButton
      label={frontendMessage("settings.tools.manageExtensions")}
      tooltip={frontendMessage("settings.tools.manageExtensions")}
      size="sm"
      tone="muted"
      disabled={!connected || draftState.saving}
      onClick={() => setBulkManagerOpen(true)}
    >
      <AppIcon icon="settings" size={16} aria-hidden="true" />
    </IconButton>
  );
  const filterOptions = [
    { value: "all", label: frontendMessage("settings.entityNavigator.all") },
    { value: "enabled", label: frontendMessage("settings.tools.status.enabled") },
    { value: "disabled", label: frontendMessage("settings.tools.status.disabled") },
  ];
  const navigator = (
    <SettingsEntityNavigator
      title={frontendMessage("settings.tools.extensionCount", { count: extensions.length })}
      summary={frontendMessage("settings.tools.navigatorSummary", {
        enabled: extensions.filter((extension) => readExtensionDraft(draftState.draft, extension).enabled).length,
      })}
      groups={domainGroups.map((group) => ({
        id: group.domain.id,
        label: resolveFrontendLocalizedText(group.domain.displayName, locale),
        items: group.extensions,
      }))}
      search={search}
      searchPlaceholder={frontendMessage("settings.tools.search")}
      clearSearchLabel={frontendMessage("settings.entityNavigator.clearSearch")}
      filterLabel={frontendMessage("settings.entityNavigator.filter")}
      filterValue={statusFilter}
      filterOptions={filterOptions}
      emptyMessage={
        extensions.length === 0
          ? frontendMessage("settings.tools.emptyExtensions")
          : frontendMessage("settings.entityNavigator.noMatches")
      }
      refreshAction={
        <div className="flex items-center gap-1">
          {manageExtensionsButton}
          {refreshButton}
        </div>
      }
      getItemKey={(extension) => extension.id}
      selectedItemKey={selected?.id}
      renderItem={(extension, { fluidHoverEnabled }) => {
        const extensionDraft = readExtensionDraft(draftState.draft, extension);
        return (
          <ExtensionNavigatorRow
            extension={extension}
            locale={locale}
            enabled={extensionDraft.enabled}
            configurationFieldCount={configurationFieldCounts.get(extension.id) ?? 0}
            selected={selected?.id === extension.id}
            fluidHoverEnabled={fluidHoverEnabled}
            onSelect={() => selectExtension(extension.id)}
          />
        );
      }}
      onSearchChange={setSearch}
      onFilterChange={(value) => setStatusFilter(value as ExtensionStatusFilter)}
    />
  );
  const detail = selected ? (
    <ExtensionDetail
      selected={selected}
      locale={locale}
      connected={connected}
      enabled={enabled}
      configuration={configuration}
      configurationSections={configurationSections}
      readSecret={readSecret}
      error={draftState.localError}
      onChange={updateExtension}
      onCommit={draftState.flushSave}
    />
  ) : (
    <StateView
      status="empty"
      className="min-h-[220px] bg-surface-canvas"
      icon={<AppIcon icon="package" size={18} className="text-content-muted" />}
      title={frontendMessage("settings.tools.selectExtension")}
    />
  );

  if (detailExtensionId !== undefined) {
    return (
      <div className="h-full min-h-0 overflow-hidden" data-system-extension-detail>
        {detail}
      </div>
    );
  }

  return (
    <>
      <div ref={layoutRef} className="h-full min-h-0 overflow-hidden" data-system-extension-layout={layout}>
        {layout === "compact" ? (
          mobileDetailOpen && selected ? (
            <div
              className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas"
              data-system-extension-detail
            >
              <button
                type="button"
                className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line-subtle/70 px-3 text-left text-[12.5px] font-medium text-content-secondary transition hover:bg-surface-hover hover:text-content-primary"
                onClick={() => setMobileDetailOpen(false)}
              >
                <AppIcon icon="chevron-right" size={16} className="rotate-180" aria-hidden="true" />
                {frontendMessage("settings.tools.backToExtensions")}
              </button>
              <div className="min-h-0 flex-1 overflow-hidden">{detail}</div>
            </div>
          ) : (
            <div className="h-full min-h-0" data-system-extension-directory>
              {navigator}
            </div>
          )
        ) : (
          <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)] overflow-hidden bg-surface-sidebar">
            <div className="h-full min-h-0 overflow-hidden" data-system-extension-directory>
              {navigator}
            </div>
            <div className="h-full min-h-0 min-w-0 overflow-hidden" data-system-extension-detail>
              {detail}
            </div>
          </div>
        )}
      </div>
      <ExtensionBulkManager
        open={bulkManagerOpen}
        onOpenChange={setBulkManagerOpen}
        extensions={extensions}
        locale={locale}
        draft={draftState.draft}
        configurationFieldCounts={configurationFieldCounts}
        connected={connected}
        onToggle={toggleExtensionEnabled}
      />
    </>
  );
}

function ExtensionBulkManager({
  open,
  onOpenChange,
  extensions,
  locale,
  draft,
  configurationFieldCounts,
  connected,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extensions: readonly SystemExtensionSettingsItem[];
  locale: FrontendLocale;
  draft: Record<string, unknown>;
  configurationFieldCounts: ReadonlyMap<string, number>;
  connected: boolean;
  onToggle: (extension: SystemExtensionSettingsItem, enabled: boolean) => void;
}): JSX.Element {
  const groups = projectSystemExtensionDirectoryGroups(extensions);
  const enabledCount = extensions.filter((extension) => readExtensionDraft(draft, extension).enabled).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("settings.tools.manageExtensions")}
        description={frontendMessage("settings.tools.manageExtensionsDescription", {
          enabled: enabledCount,
          total: extensions.length,
        })}
        data-extension-bulk-manager
        className="h-[min(78dvh,700px)] w-[min(680px,calc(100vw-2rem))] max-w-none"
        bodyClassName="flex min-h-0 flex-1 flex-col bg-surface-canvas"
      >
        <ScrollArea className="min-h-0 flex-1" data-extension-bulk-scroll-region>
          <div className="px-5 py-3 sm:px-6">
            {groups.map((group) => (
              <section key={group.domain.id} className="py-2" data-extension-bulk-group={group.domain.id}>
                <div className="flex items-center justify-between gap-3 px-1 pb-2 pt-1">
                  <span className="text-[11px] font-medium text-content-muted">
                    {resolveFrontendLocalizedText(group.domain.displayName, locale)}
                  </span>
                  <span className="text-[10px] tabular-nums text-content-muted">{group.extensions.length}</span>
                </div>
                <div className="divide-y divide-line-subtle border-y border-line-subtle">
                  {group.extensions.map((extension) => {
                    const state = readExtensionDraft(draft, extension);
                    const name = resolveFrontendLocalizedText(extension.displayName, locale);
                    return (
                      <div key={extension.id} className="flex min-h-12 items-center gap-3 py-2.5">
                        <PluginIdentityFrame>
                          <PluginIdentityIcon
                            brandIcon={extension.presentation?.brandIcon}
                            icon={extension.presentation?.icon}
                            size={18}
                          />
                        </PluginIdentityFrame>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-baseline gap-1.5">
                            <span className="truncate text-[12px] font-medium text-content-primary">{name}</span>
                            <span className="shrink-0 text-[10px] tabular-nums text-content-muted">
                              v{extension.version}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[10.5px] text-content-muted">
                            {configurationFieldCounts.get(extension.id) === 0
                              ? frontendMessage("settings.entityPreview.noConfiguration")
                              : frontendMessage("settings.entityPreview.configurationCount", {
                                  count: configurationFieldCounts.get(extension.id) ?? 0,
                                })}
                          </span>
                        </span>
                        <Switch
                          checked={state.enabled}
                          size="sm"
                          disabled={!connected}
                          ariaLabel={frontendMessage("settings.tools.enableExtension", { name })}
                          onCheckedChange={(next) => onToggle(extension, next)}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ExtensionNavigatorRow({
  extension,
  locale,
  enabled,
  configurationFieldCount,
  selected,
  fluidHoverEnabled,
  onSelect,
}: {
  extension: SystemExtensionSettingsItem;
  locale: FrontendLocale;
  enabled: boolean;
  configurationFieldCount: number;
  selected: boolean;
  fluidHoverEnabled: boolean;
  onSelect: () => void;
}): JSX.Element {
  const displayName = resolveFrontendLocalizedText(extension.displayName, locale);
  return (
    <div
      className={cn(
        "relative flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
        selected
          ? "text-accent-content"
          : cn("text-content-secondary", fluidHoverEnabled ? "" : "hover:bg-surface-hover"),
      )}
      data-extension-enabled={enabled ? "on" : "off"}
    >
      <button
        type="button"
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
        onClick={onSelect}
      >
        <PluginIdentityFrame>
          <PluginIdentityIcon
            brandIcon={extension.presentation?.brandIcon}
            icon={extension.presentation?.icon}
            size={18}
          />
        </PluginIdentityFrame>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[12px] font-medium">{displayName}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-content-muted">v{extension.version}</span>
          </span>
          <span className="mt-0.5 block truncate text-[10.5px] text-content-muted" data-extension-preview>
            {configurationFieldCount === 0
              ? frontendMessage("settings.entityPreview.noConfiguration")
              : frontendMessage("settings.entityPreview.configurationCount", { count: configurationFieldCount })}
          </span>
        </span>
      </button>
      <SettingsBinaryStateToken
        state={enabled ? "on" : "off"}
        className="shrink-0"
        ariaLabel={frontendMessage(`settings.tools.status.${enabled ? "enabled" : "disabled"}`)}
      />
    </div>
  );
}

function ExtensionDetail({
  selected,
  locale,
  connected,
  enabled,
  configuration,
  configurationSections,
  readSecret,
  error,
  onChange,
  onCommit,
}: {
  selected: SystemExtensionSettingsItem;
  locale: FrontendLocale;
  connected: boolean;
  enabled: boolean;
  configuration: Record<string, unknown>;
  configurationSections: ReturnType<typeof projectSectionConfigFields>[];
  readSecret: ((field: import("../../../api/eventTypes").ConfigFormFieldData) => Promise<string>) | undefined;
  error: string | null;
  onChange: (enabled: boolean, configuration: Record<string, unknown>, mode: ConfigDraftSaveMode) => void;
  onCommit: () => void;
}): JSX.Element {
  const displayName = resolveFrontendLocalizedText(selected.displayName, locale);
  const description = resolveFrontendLocalizedText(selected.description, locale);
  const hasConfiguration = configurationSections.length > 0;
  const [detailView, setDetailView] = useState<ExtensionDetailView>("contributions");

  useEffect(() => setDetailView("contributions"), [selected.id]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas font-sans">
      <header className="shrink-0 border-b border-line-subtle/70 px-6 py-5 sm:px-8">
        <div className="mx-auto flex w-full max-w-[860px] items-start justify-between gap-5">
          <div className="flex min-w-0 items-start gap-3">
            <PluginIdentityFrame className="mt-0.5">
              <PluginIdentityIcon
                brandIcon={selected.presentation?.brandIcon}
                icon={selected.presentation?.icon}
                size={22}
              />
            </PluginIdentityFrame>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="truncate text-[17px] font-semibold text-content-primary">{displayName}</h3>
                <span className="text-[11px] tabular-nums text-content-muted">v{selected.version}</span>
              </div>
              <p className="mt-1 max-w-[620px] text-[12px] leading-5 text-content-secondary">{description}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            <Switch
              checked={enabled}
              size="sm"
              disabled={!connected}
              ariaLabel={frontendMessage("settings.tools.enableExtension", { name: displayName })}
              onCheckedChange={(next) => onChange(next, configuration, "immediate")}
            />
          </div>
        </div>
        <div className="mx-auto mt-4 w-full max-w-[860px]">
          <SegmentedControl
            ariaLabel={frontendMessage("settings.tools.detailView")}
            options={[
              { value: "contributions", label: frontendMessage("settings.tools.viewContributions") },
              { value: "configuration", label: frontendMessage("settings.tools.viewConfiguration") },
            ]}
            value={detailView}
            onChange={setDetailView}
          />
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {error ? <InlineError className="mx-auto mt-4 max-w-[860px] px-6 sm:px-8">{error}</InlineError> : null}
        <div className="mx-auto w-full max-w-[860px] px-6 py-6 sm:px-8">
          {detailView === "contributions" ? (
            <ExtensionContributions selected={selected} locale={locale} />
          ) : (
            <ExtensionConfiguration
              selected={selected}
              connected={connected}
              enabled={enabled}
              configuration={configuration}
              configurationSections={configurationSections}
              hasConfiguration={hasConfiguration}
              readSecret={readSecret}
              onChange={onChange}
              onCommit={onCommit}
            />
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

function ExtensionContributions({
  selected,
  locale,
}: {
  selected: SystemExtensionSettingsItem;
  locale: FrontendLocale;
}): JSX.Element {
  return (
    <>
      <SettingsEntityMetrics
        dataTestId="extension-metrics"
        items={[
          { label: frontendMessage("settings.entitySummary.tools"), value: selected.tools.length },
          { label: frontendMessage("settings.entitySummary.skills"), value: selected.skillCount },
          { label: frontendMessage("settings.entitySummary.mcpServers"), value: selected.mcpServerCount },
        ]}
      />
      {selected.tools.length > 0 ? (
        <ExtensionToolList className="mt-5" tools={selected.tools} locale={locale} />
      ) : (
        <p className="border-y border-line-subtle py-7 text-[12px] text-content-muted">
          {frontendMessage("settings.tools.noTools")}
        </p>
      )}
    </>
  );
}

function ExtensionConfiguration({
  selected,
  connected,
  enabled,
  configuration,
  configurationSections,
  hasConfiguration,
  readSecret,
  onChange,
  onCommit,
}: {
  selected: SystemExtensionSettingsItem;
  connected: boolean;
  enabled: boolean;
  configuration: Record<string, unknown>;
  configurationSections: ReturnType<typeof projectSectionConfigFields>[];
  hasConfiguration: boolean;
  readSecret: ((field: import("../../../api/eventTypes").ConfigFormFieldData) => Promise<string>) | undefined;
  onChange: (enabled: boolean, configuration: Record<string, unknown>, mode: ConfigDraftSaveMode) => void;
  onCommit: () => void;
}): JSX.Element {
  if (!hasConfiguration) {
    return (
      <div className="border-y border-line-subtle py-7">
        <p className="text-[13px] font-medium text-content-primary">
          {frontendMessage("settings.entityPreview.noConfiguration")}
        </p>
        <p className="mt-1 text-[12px] leading-5 text-content-muted">
          {frontendMessage("settings.tools.noConfiguration")}
        </p>
      </div>
    );
  }

  return (
    <JsonConfigSettingsView
      key={selected.id}
      layoutMode="embedded"
      sections={configurationSections}
      value={configuration}
      disabled={!connected}
      readSecret={readSecret}
      onChange={(next) => onChange(enabled, next, "debounced")}
      onCommit={onCommit}
    />
  );
}

function ExtensionToolList({
  className,
  tools,
  locale,
}: {
  className?: string;
  tools: SystemExtensionSettingsItem["tools"];
  locale: FrontendLocale;
}): JSX.Element {
  return (
    <section className={className} data-system-extension-tools>
      <div className="divide-y divide-line-subtle border-y border-line-subtle">
        {tools.map((tool) => (
          <div key={tool.name} className="flex min-w-0 gap-3 py-4">
            <PluginIdentityFrame data-system-extension-tool-icon={tool.presentation.icon}>
              <AgentToolPresentationIcon icon={tool.presentation.icon} size={17} aria-hidden="true" />
            </PluginIdentityFrame>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                <div className="truncate text-[12.5px] font-semibold text-content-primary">
                  {resolveFrontendLocalizedText(tool.presentation.activity.action, locale)}
                </div>
                <code className="truncate text-[10.5px] text-content-muted">{tool.name}</code>
              </div>
              <p className="mt-1.5 max-w-[680px] text-[12px] leading-5 text-content-secondary">
                {resolveFrontendLocalizedText(tool.description, locale)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export interface SystemExtensionDirectoryGroup {
  readonly domain: SystemExtensionSettingsItem["domain"];
  readonly extensions: readonly SystemExtensionSettingsItem[];
}

/** The extension manifest domain is the sole grouping authority. */
export function projectSystemExtensionDirectoryGroups(
  extensions: readonly SystemExtensionSettingsItem[],
): readonly SystemExtensionDirectoryGroup[] {
  const groups = new Map<
    string,
    { domain: SystemExtensionSettingsItem["domain"]; extensions: SystemExtensionSettingsItem[] }
  >();
  for (const extension of extensions) {
    const current = groups.get(extension.domain.id);
    if (current) current.extensions.push(extension);
    else groups.set(extension.domain.id, { domain: extension.domain, extensions: [extension] });
  }
  return [...groups.values()].sort((left, right) => left.domain.id.localeCompare(right.domain.id));
}

export function projectVisibleExtensionConfigurationSections(
  extension: SystemExtensionSettingsItem | null,
  locale: FrontendLocale,
  configSnapshot: Parameters<typeof projectSystemExtensionConfigurationSections>[0]["configSnapshot"],
): ReturnType<typeof projectSectionConfigFields>[] {
  const sections = projectSystemExtensionConfigurationSections({
    sections: extension?.configuration?.sections ?? [],
    locale,
    configSnapshot,
  });
  return sections
    .map((section) => projectSectionConfigFields(section, sections))
    .filter((section) => section.fields.length > 0);
}

function readExtensionDraft(
  draft: Record<string, unknown>,
  extension: SystemExtensionSettingsItem,
): { enabled: boolean; configuration: Record<string, unknown> } {
  const extensions = isJsonConfigObject(draft.Extensions) ? draft.Extensions : {};
  const rawEntry = extensions[extension.id];
  const entry = isJsonConfigObject(rawEntry) ? rawEntry : {};
  return {
    enabled: typeof entry.Enabled === "boolean" ? entry.Enabled : extension.enabled,
    configuration: isJsonConfigObject(entry.Configuration)
      ? entry.Configuration
      : (extension.configuration?.value ?? {}),
  };
}

function writeExtensionDraft(
  draft: Record<string, unknown>,
  extension: SystemExtensionSettingsItem,
  enabled: boolean,
  configuration: Record<string, unknown>,
): Record<string, unknown> {
  const currentExtensions = isJsonConfigObject(draft.Extensions) ? draft.Extensions : {};
  const nextExtensions = structuredClone(currentExtensions);
  const entry: Record<string, unknown> = { Enabled: enabled };
  if (extension.configuration && Object.keys(configuration).length > 0)
    entry.Configuration = structuredClone(configuration);
  if (enabled && !extension.configuration && !extension.configured) delete nextExtensions[extension.id];
  else nextExtensions[extension.id] = entry;
  return { ...draft, Extensions: nextExtensions };
}

export { readExtensionDraft as readSettingsExtensionDraft, writeExtensionDraft as writeSettingsExtensionDraft };
