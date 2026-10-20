import { useEffect, useMemo, useState } from "react";
import type { McpServerSettingsItem, SystemExtensionSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { AppIcon, ScrollArea, SegmentedControl, StateView, Switch } from "../../../shared/ui";
import { AgentSystemExtensionSettingsSurfaces } from "../../../../../Source/AgentSystem/Types/AgentSystemExtensionSettingsSurface";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import type { ConfigSettingsDraftState } from "./configSettingsDraftState";
import { McpServersSection } from "./McpServersSection";
import {
  projectVisibleExtensionConfigurationSections,
  readSettingsExtensionDraft,
  SystemToolsSection,
  writeSettingsExtensionDraft,
} from "./SystemToolsSection";
import { PluginIdentityFrame, PluginIdentityIcon } from "./PluginIdentityIcon";
import {
  isMcpServerEnablementMutable,
  readMcpServerEnabledDraft,
  writeMcpServerEnabledDraft,
} from "./mcpServerEnablement";

type PluginKind = "extension" | "mcp";
type PluginFilter = "all" | PluginKind;

type PluginDirectoryItem =
  | {
      readonly kind: "extension";
      readonly key: string;
      readonly source: SystemExtensionSettingsItem;
      readonly configurationFieldCount: number;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "mcp";
      readonly key: string;
      readonly source: McpServerSettingsItem;
      readonly configurationFieldCount: number;
      readonly enabled: boolean;
    };

export function PluginsSection({
  draftState,
  systemConfig,
}: {
  draftState: ConfigSettingsDraftState;
  systemConfig?: SettingsSystemConfigHandle;
}): JSX.Element {
  const locale = useFrontendLocale();
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PluginDirectoryItem | null>(null);
  const extensions = useMemo(
    () =>
      (systemConfig?.systemExtensions ?? []).filter(
        (extension) => extension.settingsSurface === AgentSystemExtensionSettingsSurfaces.SystemTools,
      ),
    [systemConfig?.systemExtensions],
  );
  const pluginItems = useMemo<readonly PluginDirectoryItem[]>(() => {
    const extensionItems = extensions.map((source) => ({
      kind: "extension" as const,
      key: `extension:${source.id}`,
      source,
      enabled: readSettingsExtensionDraft(draftState.draft, source).enabled,
      configurationFieldCount: projectVisibleExtensionConfigurationSections(
        source,
        locale,
        systemConfig?.configSnapshot ?? null,
      ).reduce((count, section) => count + section.fields.length, 0),
    }));
    const mcpItems = (systemConfig?.mcpServers ?? []).map((source) => ({
      kind: "mcp" as const,
      key: `mcp:${source.id}`,
      source,
      configurationFieldCount: source.inputs.length,
      enabled: readMcpServerEnabledDraft(draftState.draft, source),
    }));
    return [...extensionItems, ...mcpItems];
  }, [draftState.draft, extensions, locale, systemConfig?.configSnapshot, systemConfig?.mcpServers]);
  const visibleItems = useMemo(() => {
    const normalizedQuery = search.trim().toLocaleLowerCase(locale);
    return pluginItems.filter((item) => {
      if (filter !== "all" && item.kind !== filter) return false;
      if (!normalizedQuery) return true;
      return [
        resolveFrontendLocalizedText(item.source.displayName, locale),
        resolveFrontendLocalizedText(item.source.description, locale),
      ]
        .join(" ")
        .toLocaleLowerCase(locale)
        .includes(normalizedQuery);
    });
  }, [filter, locale, pluginItems, search]);
  const selectedItem = selected ? (pluginItems.find((item) => item.key === selected.key) ?? null) : null;

  useEffect(() => {
    if (selected && !selectedItem) setSelected(null);
  }, [selected, selectedItem]);

  if (!systemConfig || !systemConfig.toolSettingsSynced.systemTools || !systemConfig.toolSettingsSynced.mcpServers) {
    return <StateView status="loading" description={frontendMessage("settings.plugins.loading")} />;
  }

  const setExtensionEnabled = (extension: SystemExtensionSettingsItem, enabled: boolean): void => {
    const current = readSettingsExtensionDraft(draftState.draft, extension);
    draftState.updateDraft(
      writeSettingsExtensionDraft(draftState.draft, extension, enabled, current.configuration),
      "immediate",
    );
  };
  const setMcpServerEnabled = (server: McpServerSettingsItem, enabled: boolean): void => {
    draftState.updateDraft(writeMcpServerEnabledDraft(draftState.draft, server, enabled), "immediate");
  };

  if (selectedItem) {
    return (
      <PluginDetailPage
        item={selectedItem}
        draftState={draftState}
        systemConfig={systemConfig}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas" data-plugins-directory>
      <header className="shrink-0 border-b border-line-subtle/70 bg-surface-canvas px-5 py-3.5 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            ariaLabel={frontendMessage("settings.plugins.typeFilter")}
            options={[
              {
                value: "all",
                label: frontendMessage("settings.plugins.allCount", { count: pluginItems.length }),
              },
              {
                value: "extension",
                label: frontendMessage("settings.plugins.systemExtensionsCount", { count: extensions.length }),
              },
              {
                value: "mcp",
                label: frontendMessage("settings.plugins.mcpServersCount", { count: systemConfig.mcpServers.length }),
              },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <div className="flex min-w-[min(100%,280px)] flex-1 items-center justify-end sm:flex-none">
            <label className="flex h-9 min-w-0 max-w-[320px] flex-1 items-center gap-2 rounded-lg border border-line-subtle/70 bg-surface-subtle/55 px-3 text-content-muted transition focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus sm:w-[260px]">
              <AppIcon icon="search" size={15} aria-hidden="true" />
              <input
                value={search}
                aria-label={frontendMessage("settings.plugins.search")}
                placeholder={frontendMessage("settings.plugins.search")}
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-content-primary outline-none placeholder:text-content-muted"
                onChange={(event) => setSearch(event.target.value)}
              />
              {search ? (
                <button
                  type="button"
                  aria-label={frontendMessage("settings.entityNavigator.clearSearch")}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-content-muted hover:bg-surface-hover hover:text-content-primary"
                  onClick={() => setSearch("")}
                >
                  <AppIcon icon="close" size={14} aria-hidden="true" />
                </button>
              ) : null}
            </label>
          </div>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        <div className="mx-auto w-full max-w-[1180px] px-5 py-6 sm:px-7 sm:py-8">
          <div className="mb-4">
            <h2 className="text-[13px] font-semibold text-content-primary">
              {frontendMessage("settings.plugins.directory")}
            </h2>
          </div>
          {visibleItems.length ? (
            <div
              className="grid min-w-0 grid-cols-1 gap-x-10 border-y border-line-subtle sm:grid-cols-2"
              data-plugin-directory-grid
            >
              {visibleItems.map((item) => (
                <PluginDirectoryRow
                  key={item.key}
                  item={item}
                  locale={locale}
                  disabled={draftState.saving || systemConfig.socketStatus !== "open"}
                  onSelect={() => setSelected(item)}
                  onExtensionEnabledChange={setExtensionEnabled}
                  onMcpEnabledChange={setMcpServerEnabled}
                />
              ))}
            </div>
          ) : (
            <StateView
              status="empty"
              className="min-h-[220px] bg-surface-canvas"
              title={frontendMessage("settings.entityNavigator.noMatches")}
            />
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

function PluginDirectoryRow({
  item,
  locale,
  disabled,
  onSelect,
  onExtensionEnabledChange,
  onMcpEnabledChange,
}: {
  item: PluginDirectoryItem;
  locale: Parameters<typeof resolveFrontendLocalizedText>[1];
  disabled: boolean;
  onSelect: () => void;
  onExtensionEnabledChange: (extension: SystemExtensionSettingsItem, enabled: boolean) => void;
  onMcpEnabledChange: (server: McpServerSettingsItem, enabled: boolean) => void;
}): JSX.Element {
  const displayName = resolveFrontendLocalizedText(item.source.displayName, locale);
  const description = resolveFrontendLocalizedText(item.source.description, locale);
  const presentation = item.source.presentation;
  const configurationSummary =
    item.configurationFieldCount === 0
      ? frontendMessage("settings.entityPreview.noConfiguration")
      : frontendMessage("settings.entityPreview.configurationCount", { count: item.configurationFieldCount });
  return (
    <div
      className="group flex min-h-[92px] min-w-0 items-center border-b border-line-subtle last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0"
      data-plugin-directory-item={item.kind}
    >
      <button
        type="button"
        className="flex min-h-[92px] min-w-0 flex-1 items-center gap-3 px-1 py-4 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent-focus sm:px-2"
        onClick={onSelect}
      >
        <PluginIdentityFrame>
          <PluginIdentityIcon brandIcon={presentation?.brandIcon} icon={presentation?.icon} size={18} />
        </PluginIdentityFrame>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-content-primary">{displayName}</span>
            {item.kind === "extension" ? (
              <span className="shrink-0 text-[10.5px] tabular-nums text-content-muted">v{item.source.version}</span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-[11.5px] leading-4 text-content-secondary">{description}</span>
          <span className="mt-1 block text-[10.5px] leading-4 text-content-muted">{configurationSummary}</span>
        </span>
      </button>
      <span className="shrink-0">
        {item.kind === "extension" ? (
          <Switch
            checked={item.enabled}
            size="sm"
            disabled={disabled}
            ariaLabel={frontendMessage("settings.tools.enableExtension", { name: displayName })}
            onCheckedChange={(enabled) => onExtensionEnabledChange(item.source, enabled)}
          />
        ) : (
          <Switch
            checked={item.enabled}
            size="sm"
            disabled={disabled || !isMcpServerEnablementMutable(item.source)}
            ariaLabel={frontendMessage("settings.mcp.enableServer", { name: displayName })}
            onCheckedChange={(enabled) => onMcpEnabledChange(item.source, enabled)}
          />
        )}
      </span>
    </div>
  );
}

function PluginDetailPage({
  item,
  draftState,
  systemConfig,
  onBack,
}: {
  item: PluginDirectoryItem;
  draftState: ConfigSettingsDraftState;
  systemConfig: SettingsSystemConfigHandle;
  onBack: () => void;
}): JSX.Element {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas" data-plugin-detail-page>
      <button
        type="button"
        className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line-subtle/70 px-5 text-left text-[12.5px] font-medium text-content-secondary transition hover:bg-surface-hover hover:text-content-primary sm:px-7"
        onClick={onBack}
      >
        <AppIcon icon="chevron-right" size={16} className="rotate-180" aria-hidden="true" />
        {frontendMessage("settings.plugins.backToDirectory")}
      </button>
      <div className="min-h-0 flex-1 overflow-hidden">
        {item.kind === "extension" ? (
          <SystemToolsSection draftState={draftState} systemConfig={systemConfig} detailExtensionId={item.source.id} />
        ) : (
          <McpServersSection
            systemConfig={systemConfig}
            detailServerId={item.source.id}
            activationControl={{
              enabled: item.enabled,
              disabled:
                draftState.saving || systemConfig.socketStatus !== "open" || !isMcpServerEnablementMutable(item.source),
              onEnabledChange: (enabled) =>
                draftState.updateDraft(writeMcpServerEnabledDraft(draftState.draft, item.source, enabled), "immediate"),
            }}
          />
        )}
      </div>
    </section>
  );
}
