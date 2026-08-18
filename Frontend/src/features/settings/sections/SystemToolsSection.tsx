import { useEffect, useMemo, useState } from "react";
import ArrowPathIcon from "@heroicons/react/24/outline/ArrowPathIcon";
import CubeTransparentIcon from "@heroicons/react/24/outline/CubeTransparentIcon";
import PauseCircleIcon from "@heroicons/react/24/outline/PauseCircleIcon";
import WrenchScrewdriverIcon from "@heroicons/react/24/outline/WrenchScrewdriverIcon";
import type { SystemExtensionSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText, type FrontendLocale } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { cn } from "../../../lib/util";
import { JsonConfigSettingsView } from "../../../shared/config/JsonConfigForm";
import { isJsonConfigObject } from "../../../shared/config/JsonConfigValue";
import { IconButton, InlineError, ScrollArea, StateView, Switch } from "../../../shared/ui";
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
  const extensions = systemConfig?.systemExtensions ?? EmptyExtensions;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = extensions.find((extension) => extension.id === selectedId) ?? extensions[0];
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
    if (!extensions.some((extension) => extension.id === selectedId)) setSelectedId(extensions[0]?.id ?? null);
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

  return (
    <section className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(180px,36%)_minmax(0,1fr)] overflow-hidden bg-paper-50 md:grid-cols-[248px_minmax(0,1fr)] md:grid-rows-1">
      <div className="flex min-h-0 flex-col border-b border-ink-200/70 md:border-b-0 md:border-r">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-ink-200/70 px-3">
          <div className="text-[12px] text-ink-500">
            {frontendMessage("settings.tools.extensionCount", { count: extensions.length })}
          </div>
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
        </div>
        {extensions.length === 0 ? (
          <StateView
            status="empty"
            icon={<CubeTransparentIcon className="h-4 w-4 text-ink-400" />}
            title={frontendMessage("settings.tools.emptyExtensions")}
          />
        ) : (
          <ScrollArea className="min-h-0 flex-1" viewportClassName="p-2">
            <div className="space-y-0.5">
              {extensions.map((extension) => (
                <ExtensionRow
                  key={extension.id}
                  extension={extension}
                  locale={locale}
                  selected={extension.id === selected?.id}
                  enabled={readExtensionDraft(draftState.draft, extension).enabled}
                  onSelect={() => {
                    setSelectedId(extension.id);
                  }}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
      {selected ? (
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex min-w-0 shrink-0 items-start justify-between gap-4 border-b border-ink-200/70 px-5 py-3.5 sm:px-6">
            <div className="flex min-w-0 items-start gap-2.5">
              <CubeTransparentIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-450" aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="truncate text-[14px] font-semibold text-ink-900" title={selected.id}>
                  {selectedDisplayName}
                </h3>
                <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-ink-500">{selectedDescription}</p>
              </div>
            </div>
            <Switch
              checked={enabled}
              disabled={!connected}
              ariaLabel={frontendMessage("settings.tools.enableExtension", { name: selectedDisplayName })}
              onCheckedChange={(next) => updateExtension(next, configuration, "immediate")}
            />
          </div>
          <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
            {draftState.localError ? (
              <InlineError className="mx-5 mt-3 sm:mx-6">{draftState.localError}</InlineError>
            ) : null}
            {selected.tools.length > 0 ? <ExtensionToolList tools={selected.tools} /> : null}
            {hasConfiguration ? (
              <section className={selected.tools.length > 0 ? "border-t border-ink-200/70" : undefined}>
                <div className="flex items-center gap-2 px-5 pt-5 sm:px-6">
                  <WrenchScrewdriverIcon className="h-3.5 w-3.5 text-ink-450" aria-hidden="true" />
                  <h4 className="text-[12px] font-semibold text-ink-800">
                    {frontendMessage("settings.config.primaryGroupTitle")}
                  </h4>
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
            {selected.tools.length === 0 && !hasConfiguration ? (
              <StateView
                status="empty"
                className="min-h-64"
                icon={<CubeTransparentIcon className="h-4 w-4 text-ink-400" />}
                title={frontendMessage("settings.tools.noTools")}
              />
            ) : null}
          </ScrollArea>
        </div>
      ) : (
        <StateView status="empty" title={frontendMessage("settings.tools.selectExtension")} />
      )}
    </section>
  );
}

function ExtensionRow({
  extension,
  locale,
  selected,
  enabled,
  onSelect,
}: {
  extension: SystemExtensionSettingsItem;
  locale: FrontendLocale;
  selected: boolean;
  enabled: boolean;
  onSelect: () => void;
}): JSX.Element {
  const displayName = resolveFrontendLocalizedText(extension.displayName, locale);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
        selected
          ? "bg-accent-surface text-accent-content"
          : "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
        !enabled && "text-ink-450",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{displayName}</span>
      </span>
      {!enabled ? (
        <PauseCircleIcon
          className="ml-auto h-4 w-4 shrink-0 text-ink-400"
          aria-label={frontendMessage("settings.tools.status.disabled")}
        />
      ) : null}
    </button>
  );
}

function ExtensionToolList({ tools }: { tools: SystemExtensionSettingsItem["tools"] }): JSX.Element {
  return (
    <section className="px-5 py-5 sm:px-6" data-system-extension-tools>
      <div className="mb-2 flex items-center gap-2">
        <WrenchScrewdriverIcon className="h-3.5 w-3.5 text-ink-450" aria-hidden="true" />
        <h4 className="text-[12px] font-semibold text-ink-800">{frontendMessage("settings.tools.contributedTools")}</h4>
        <span className="text-[11px] tabular-nums text-ink-450">{tools.length}</span>
      </div>
      <div className="divide-y divide-ink-200/70 border-y border-ink-200/70">
        {tools.map((tool) => (
          <div key={tool.name} className="min-w-0 py-3">
            <code className="block truncate text-[12px] font-semibold text-ink-850">{tool.name}</code>
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-ink-500">{tool.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
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
