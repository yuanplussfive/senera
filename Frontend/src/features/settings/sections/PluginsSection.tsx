import { Tooltip } from "../../../shared/ui/Tooltip";
import { useEffect, useMemo, useState } from "react";
import type { McpServerSettingsItem, SystemExtensionSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { AppIcon, Button, IconButton, ScrollArea, SegmentedControl, StateView, Switch } from "../../../shared/ui";
import { AgentSystemExtensionSettingsSurfaces } from "../../../../../Source/AgentSystem/Types/AgentSystemExtensionSettingsSurface";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import { SettingsSectionLoading } from "../SettingsLoading";
import type { ConfigSettingsDraftState } from "./configSettingsDraftState";
import { McpServersSection } from "./McpServersSection";
import {
  projectVisibleExtensionConfigurationSections,
  readSettingsExtensionDraft,
  SystemToolsSection,
  writeSettingsExtensionDraft,
} from "./SystemToolsSection";
import { PluginIdentityTile, PluginIdentityIcon } from "./PluginIdentityIcon";
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const extensions = useMemo(
    () =>
      (systemConfig?.systemExtensions ?? []).filter(
        (extension) => extension.settingsSurface === AgentSystemExtensionSettingsSurfaces.SystemTools,
      ),
    [systemConfig?.systemExtensions],
  );
  const extensionItems = useMemo(
    () =>
      extensions.map((source) => ({
        kind: "extension" as const,
        key: `extension:${source.id}`,
        source,
        configurationFieldCount: projectVisibleExtensionConfigurationSections(
          source,
          locale,
          systemConfig?.configSnapshot ?? null,
        ).reduce((count, section) => count + section.fields.length, 0),
      })),
    [extensions, locale, systemConfig?.configSnapshot],
  );
  const pluginItems = useMemo<readonly PluginDirectoryItem[]>(() => {
    const mcpItems = (systemConfig?.mcpServers ?? []).map((source) => ({
      kind: "mcp" as const,
      key: `mcp:${source.id}`,
      source,
      configurationFieldCount: source.inputs.length,
      enabled: readMcpServerEnabledDraft(draftState.draft, source),
    }));
    return [
      ...extensionItems.map((item) => ({
        ...item,
        enabled: readSettingsExtensionDraft(draftState.draft, item.source).enabled,
      })),
      ...mcpItems,
    ];
  }, [draftState.draft, extensionItems, systemConfig?.mcpServers]);
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
  const selectedItem = selectedKey ? (pluginItems.find((item) => item.key === selectedKey) ?? null) : null;

  useEffect(() => {
    if (selectedKey && !selectedItem) setSelectedKey(null);
  }, [selectedKey, selectedItem]);

  if (!systemConfig || !systemConfig.toolSettingsSynced.systemTools || !systemConfig.toolSettingsSynced.mcpServers) {
    return <SettingsSectionLoading variant="directory" />;
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
        onBack={() => setSelectedKey(null)}
      />
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas" data-plugins-directory>
      <header className="shrink-0 px-5 pt-4 sm:px-8 sm:pt-5">
        <div className="mx-auto flex max-w-[860px] flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line-subtle pb-1">
          <SegmentedControl
            variant="underline"
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
          <div className="mb-1 flex min-w-0 basis-full sm:basis-auto">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-content-muted transition-colors focus-within:bg-surface-subtle sm:w-52">
              <AppIcon icon="search" size={15} aria-hidden="true" />
              <input
                value={search}
                aria-label={frontendMessage("settings.plugins.search")}
                placeholder={frontendMessage("settings.plugins.search")}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-content-primary outline-none placeholder:text-content-muted"
                onChange={(event) => setSearch(event.target.value)}
              />
              {search ? (
                <IconButton
                  label={frontendMessage("settings.entityNavigator.clearSearch")}
                  size="sm"
                  tone="muted"
                  onClick={() => setSearch("")}
                >
                  <AppIcon icon="close" size={14} aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        <div className="mx-auto w-full max-w-[924px] px-5 py-3 sm:px-8 sm:py-4">
          {visibleItems.length ? (
            <div
              className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-x-8 gap-y-1"
              data-plugin-directory-grid
            >
              {visibleItems.map((item) => (
                <PluginDirectoryRow
                  key={item.key}
                  item={item}
                  locale={locale}
                  disabled={draftState.saving || systemConfig.socketStatus !== "open"}
                  onSelect={() => setSelectedKey(item.key)}
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
    item.configurationFieldCount > 0
      ? frontendMessage("settings.entityPreview.configurationCount", { count: item.configurationFieldCount })
      : undefined;
  return (
    <div
      className="group flex min-w-0 items-center gap-3 border-b border-line-subtle py-2"
      data-plugin-directory-item={item.kind}
    >
      <button
        type="button"
        className="flex min-h-[100px] min-w-0 flex-1 items-center gap-3.5 rounded-md py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
        onClick={onSelect}
      >
        <PluginIdentityTile>
          <PluginIdentityIcon brandIcon={presentation?.brandIcon} icon={presentation?.icon} size={26} />
        </PluginIdentityTile>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-[13px] font-medium leading-5 text-content-primary group-hover:text-content-strong">
              {displayName}
            </span>
          </span>
          <Tooltip content={description}>
            <span className="mt-1 line-clamp-2 text-[12px] font-normal leading-5 text-content-secondary">
              {description}
            </span>
          </Tooltip>
          {configurationSummary ? (
            <span className="mt-1 block text-[10px] text-content-muted">{configurationSummary}</span>
          ) : null}
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
      <div className="shrink-0 px-5 pt-3 sm:px-8">
        <div className="mx-auto max-w-[860px]">
          <Button variant="ghost" size="sm" className="-ml-2 gap-1.5 text-content-secondary" onClick={onBack}>
            <AppIcon icon="arrow-left" size={14} aria-hidden="true" />
            {frontendMessage("settings.plugins.backToDirectory")}
          </Button>
        </div>
      </div>
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
