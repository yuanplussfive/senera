import { useEffect, useMemo, useState } from "react";
import ArrowPathIcon from "@heroicons/react/24/outline/ArrowPathIcon";
import ArrowLeftIcon from "@heroicons/react/24/outline/ArrowLeftIcon";
import CubeTransparentIcon from "@heroicons/react/24/outline/CubeTransparentIcon";
import WrenchScrewdriverIcon from "@heroicons/react/24/outline/WrenchScrewdriverIcon";
import type { SystemExtensionSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText, type FrontendLocale } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { cn } from "../../../lib/util";
import { JsonConfigSettingsView } from "../../../shared/config/JsonConfigForm";
import { isJsonConfigObject } from "../../../shared/config/JsonConfigValue";
import { AppIcon, IconButton, InlineError, ScrollArea, StateView, Switch } from "../../../shared/ui";
import { AgentToolPresentationAppIcons } from "../../../shared/workspace/agentToolPresentationIcons";
import { AgentSystemExtensionSettingsSurfaces } from "../../../../../Source/AgentSystem/Types/AgentSystemExtensionSettingsSurface";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import { projectSystemExtensionConfigurationSections } from "../systemExtensionConfigurationPresentation";
import type { ConfigSettingsDraftState, ConfigDraftSaveMode } from "./configSettingsDraftState";
import { projectSectionConfigFields } from "./runtimeModelAssignments";

const EmptyExtensions: readonly SystemExtensionSettingsItem[] = [];

export function SystemToolsSection({
  draftState,
  systemConfig,
}: {
  draftState: ConfigSettingsDraftState;
  systemConfig?: SettingsSystemConfigHandle;
}): JSX.Element {
  const locale = useFrontendLocale();
  const extensions = (systemConfig?.systemExtensions ?? EmptyExtensions).filter(
    (extension) => extension.settingsSurface === AgentSystemExtensionSettingsSurfaces.SystemTools,
  );
  const domainGroups = projectSystemExtensionDirectoryGroups(extensions);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (extensions.find((extension) => extension.id === selectedId) ?? null) : null;
  const selectedDisplayName = selected ? resolveFrontendLocalizedText(selected.displayName, locale) : "";
  const selectedDescription = selected ? resolveFrontendLocalizedText(selected.description, locale) : "";
  const selectedDraft = selected ? readExtensionDraft(draftState.draft, selected) : null;
  const enabled = selectedDraft?.enabled ?? true;
  const configuration = selectedDraft?.configuration ?? {};
  const connected = systemConfig?.socketStatus === "open";
  const configurationSections = useMemo(() => {
    const sections = projectSystemExtensionConfigurationSections({
      sections: selected?.configuration?.sections ?? [],
      locale,
      configSnapshot: systemConfig?.configSnapshot ?? null,
    });
    return sections
      .map((section) => projectSectionConfigFields(section, sections))
      .filter((section) => section.fields.length > 0);
  }, [locale, selected?.configuration?.sections, systemConfig?.configSnapshot]);
  const hasConfiguration = configurationSections.length > 0;

  useEffect(() => {
    if (extensions.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && !extensions.some((extension) => extension.id === selectedId)) setSelectedId(null);
  }, [extensions, selectedId]);

  if (!systemConfig || !systemConfig.toolSettingsSynced.systemTools) {
    return <StateView status="loading" description={frontendMessage("settings.tools.loading")} />;
  }

  const updateExtension = (
    nextEnabled: boolean,
    nextConfiguration: Record<string, unknown>,
    mode: ConfigDraftSaveMode,
  ): void => {
    if (!selected) return;
    draftState.updateDraft(writeExtensionDraft(draftState.draft, selected, nextEnabled, nextConfiguration), mode);
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
      <ArrowPathIcon className="h-4 w-4" />
    </IconButton>
  );

  if (!selected) {
    return (
      <section
        className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas"
        data-system-extension-directory
      >
        <div className="mx-auto flex w-full max-w-[980px] shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4 lg:px-8">
          <div>
            <div className="text-[13px] font-semibold text-content-primary">
              {frontendMessage("settings.tools.extensionCount", { count: extensions.length })}
            </div>
            <p className="mt-1 text-[11px] text-content-muted">
              {frontendMessage("settings.tools.directoryDescription")}
            </p>
          </div>
          {refreshButton}
        </div>
        {extensions.length === 0 ? (
          <StateView
            status="empty"
            icon={<CubeTransparentIcon className="h-4 w-4 text-ink-400" />}
            title={frontendMessage("settings.tools.emptyExtensions")}
          />
        ) : (
          <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
            <div className="mx-auto w-full max-w-[980px] px-6 lg:px-8" data-system-extension-list>
              {domainGroups.map((group) => (
                <section
                  key={group.domain.id}
                  className="border-b border-line last:border-b-0"
                  data-system-extension-domain={group.domain.id}
                >
                  <header className="flex min-w-0 items-start gap-2.5 pb-2 pt-5">
                    <AppIcon
                      icon={AgentToolPresentationAppIcons[group.domain.presentation.icon]}
                      size={18}
                      className="mt-0.5 shrink-0 text-content-secondary"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <h3 className="text-[12.5px] font-semibold text-content-primary">
                        {resolveFrontendLocalizedText(group.domain.displayName, locale)}
                      </h3>
                      <p className="mt-0.5 text-[10.5px] leading-4 text-content-muted">
                        {resolveFrontendLocalizedText(group.domain.description, locale)}
                      </p>
                    </div>
                    <span className="ml-auto pt-0.5 text-[10.5px] tabular-nums text-content-muted">
                      {group.extensions.length}
                    </span>
                  </header>
                  <div>
                    {group.extensions.map((extension) => (
                      <ExtensionRow
                        key={extension.id}
                        extension={extension}
                        locale={locale}
                        directory
                        selected={false}
                        enabled={readExtensionDraft(draftState.draft, extension).enabled}
                        onSelect={() => setSelectedId(extension.id)}
                        onToggle={(next) => {
                          const current = readExtensionDraft(draftState.draft, extension);
                          updateExtensionFor(extension, next, current.configuration, draftState);
                        }}
                        disabled={!connected || draftState.saving}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </ScrollArea>
        )}
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas" data-system-extension-detail>
      <div className="mx-auto flex w-full max-w-[980px] shrink-0 flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-4 lg:px-8">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-content-muted transition hover:bg-surface-hover hover:text-content-primary"
            aria-label={frontendMessage("settings.tools.backToExtensions")}
            onClick={() => setSelectedId(null)}
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          {selected ? (
            <AppIcon
              icon={AgentToolPresentationAppIcons[selected.presentation?.icon ?? "tools"]}
              size={24}
              className="mt-1 shrink-0 text-accent-content"
              aria-hidden="true"
            />
          ) : (
            <CubeTransparentIcon className="mt-1 h-6 w-6 shrink-0 text-accent-content" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <h3
              className="truncate text-[17px] font-semibold tracking-[-0.01em] text-content-primary"
              title={selected.id}
            >
              {selectedDisplayName}
            </h3>
            <p className="mt-1 max-w-[620px] text-[12px] leading-5 text-content-secondary">{selectedDescription}</p>
            <p className="mt-2 text-[10.5px] text-content-muted">
              {frontendMessage("settings.tools.pluginMeta", {
                tools: selected.tools.length,
                skills: selected.skillCount,
                mcp: selected.mcpServerCount,
              })}
            </p>
          </div>
        </div>
        {refreshButton}
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {draftState.localError ? (
          <InlineError className="mx-auto mt-4 max-w-[980px] px-6 lg:px-8">{draftState.localError}</InlineError>
        ) : null}
        <div className="mx-auto w-full max-w-[900px] px-6 py-6 lg:px-8">
          {selected.tools.length > 0 ? <ExtensionToolList tools={selected.tools} locale={locale} /> : null}
          {hasConfiguration ? (
            <section className={cn(selected.tools.length > 0 ? "mt-7 border-t border-line pt-6" : undefined)}>
              <div className="flex items-center justify-between gap-3 pb-3">
                <div className="flex items-center gap-2">
                  <WrenchScrewdriverIcon className="h-3.5 w-3.5 text-ink-450" aria-hidden="true" />
                  <h4 className="text-[13px] font-semibold text-content-primary">
                    {frontendMessage("settings.config.primaryGroupTitle")}
                  </h4>
                </div>
                <span className="text-[11px] text-content-muted">{configurationSections.length}</span>
              </div>
              <JsonConfigSettingsView
                layoutMode="embedded"
                sections={configurationSections}
                value={configuration}
                disabled={!connected}
                onChange={(next) => updateExtension(enabled, next, "debounced")}
                onCommit={draftState.flushSave}
              />
            </section>
          ) : null}
        </div>
        {selected.tools.length === 0 && !hasConfiguration ? (
          <StateView
            status="empty"
            className="min-h-64"
            icon={<CubeTransparentIcon className="h-4 w-4 text-ink-400" />}
            title={frontendMessage("settings.tools.noTools")}
          />
        ) : null}
      </ScrollArea>
    </section>
  );
}

function ExtensionRow({
  extension,
  locale,
  directory = false,
  selected,
  enabled,
  onSelect,
  onToggle,
  disabled,
}: {
  extension: SystemExtensionSettingsItem;
  locale: FrontendLocale;
  directory?: boolean;
  selected: boolean;
  enabled: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  disabled: boolean;
}): JSX.Element {
  const displayName = resolveFrontendLocalizedText(extension.displayName, locale);
  const description = resolveFrontendLocalizedText(extension.description, locale);
  return (
    <div
      className={cn(
        directory
          ? "flex min-h-[68px] w-full min-w-0 items-center gap-3 border-b border-line px-1 py-3 text-left transition-colors"
          : "flex min-h-[58px] w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
        !directory && selected
          ? "bg-accent-surface text-accent-content"
          : "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
        !enabled && "text-ink-450",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex w-0 min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <AppIcon
          icon={AgentToolPresentationAppIcons[extension.presentation?.icon ?? "tools"]}
          size={20}
          className="shrink-0 text-content-secondary"
          aria-hidden="true"
        />
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-semibold">{displayName}</span>
          <span className="mt-0.5 block truncate text-[10.5px] text-content-muted">
            {shortenExtensionDescription(description)}
          </span>
        </span>
      </button>
      <span className="shrink-0">
        <Switch
          checked={enabled}
          size="sm"
          disabled={disabled}
          ariaLabel={frontendMessage("settings.tools.enableExtension", { name: displayName })}
          onCheckedChange={onToggle}
        />
      </span>
    </div>
  );
}

function ExtensionToolList({
  tools,
  locale,
}: {
  tools: SystemExtensionSettingsItem["tools"];
  locale: FrontendLocale;
}): JSX.Element {
  return (
    <section data-system-extension-tools>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h4 className="text-[13px] font-semibold text-content-primary">
          {frontendMessage("settings.tools.contributedTools")}
        </h4>
        <span className="text-[11px] tabular-nums text-content-muted">{tools.length}</span>
      </div>
      <div className="divide-y divide-line border-y border-line">
        {tools.map((tool) => (
          <div
            key={tool.name}
            className="grid min-w-0 gap-1 py-3.5 sm:grid-cols-[minmax(180px,0.44fr)_minmax(0,1fr)] sm:gap-6"
          >
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-content-primary">
                {tool.presentation
                  ? resolveFrontendLocalizedText(tool.presentation.activity.action, locale)
                  : tool.name}
              </div>
              <code className="mt-0.5 block truncate text-[10px] text-content-muted">{tool.name}</code>
            </div>
            <p className="line-clamp-2 text-[11.5px] leading-5 text-content-secondary">
              {resolveFrontendLocalizedText(tool.description, locale)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function updateExtensionFor(
  extension: SystemExtensionSettingsItem,
  enabled: boolean,
  configuration: Record<string, unknown>,
  draftState: ConfigSettingsDraftState,
): void {
  const currentExtensions = isJsonConfigObject(draftState.draft.Extensions) ? draftState.draft.Extensions : {};
  const nextExtensions = structuredClone(currentExtensions);
  const entry: Record<string, unknown> = { Enabled: enabled };
  if (extension.configuration && Object.keys(configuration).length > 0) {
    entry.Configuration = structuredClone(configuration);
  }
  if (enabled && !extension.configuration && !extension.configured) delete nextExtensions[extension.id];
  else nextExtensions[extension.id] = entry;
  draftState.updateDraft({ ...draftState.draft, Extensions: nextExtensions }, "immediate");
}

function shortenExtensionDescription(value: string): string {
  const text = value.trim().replace(/[.!?。！？]+$/u, "");
  if (!text) return "";
  return `${text}…`;
}

export interface SystemExtensionDirectoryGroup {
  readonly domain: SystemExtensionSettingsItem["domain"];
  readonly extensions: readonly SystemExtensionSettingsItem[];
}

/**
 * The manifest domain is the only grouping authority. Sorting by its stable
 * identity keeps the directory deterministic across locale changes without
 * teaching the UI any extension-specific category rules.
 */
export function projectSystemExtensionDirectoryGroups(
  extensions: readonly SystemExtensionSettingsItem[],
): readonly SystemExtensionDirectoryGroup[] {
  const groups = new Map<
    string,
    { domain: SystemExtensionSettingsItem["domain"]; extensions: SystemExtensionSettingsItem[] }
  >();
  for (const extension of extensions) {
    const current = groups.get(extension.domain.id);
    if (current) {
      current.extensions.push(extension);
      continue;
    }
    groups.set(extension.domain.id, { domain: extension.domain, extensions: [extension] });
  }
  return [...groups.values()].sort((left, right) => left.domain.id.localeCompare(right.domain.id));
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
  if (extension.configuration && Object.keys(configuration).length > 0) {
    entry.Configuration = structuredClone(configuration);
  }
  if (enabled && !extension.configuration && !extension.configured) delete nextExtensions[extension.id];
  else nextExtensions[extension.id] = entry;
  return { ...draft, Extensions: nextExtensions };
}

export { readExtensionDraft as readSettingsExtensionDraft, writeExtensionDraft as writeSettingsExtensionDraft };
