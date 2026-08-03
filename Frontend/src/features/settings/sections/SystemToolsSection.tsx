import { useEffect, useMemo, useState } from "react";
import { Package, RefreshCw, RotateCcw, Save, Wrench } from "lucide-react";
import type { SystemExtensionSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText, type FrontendLocale } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { cn } from "../../../lib/util";
import { JsonConfigSettingsView } from "../../../shared/config/JsonConfigForm";
import { isJsonConfigObject, sameJsonValue } from "../../../shared/config/JsonConfigValue";
import { Button, IconButton, InlineError, ScrollArea, StateView, Switch } from "../../../shared/ui";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import { projectSystemExtensionConfigurationSections } from "../systemExtensionConfigurationPresentation";

const EmptyExtensions: readonly SystemExtensionSettingsItem[] = [];

export function SystemToolsSection({
  systemConfig,
  onDirtyChange,
}: {
  systemConfig?: SettingsSystemConfigHandle;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const locale = useFrontendLocale();
  const extensions = systemConfig?.systemExtensions ?? EmptyExtensions;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = extensions.find((extension) => extension.id === selectedId) ?? extensions[0];
  const selectedDisplayName = selected ? resolveFrontendLocalizedText(selected.displayName, locale) : "";
  const selectedDescription = selected ? resolveFrontendLocalizedText(selected.description, locale) : "";
  const [enabled, setEnabled] = useState(true);
  const [configuration, setConfiguration] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const connected = systemConfig?.socketStatus === "open";
  const saving = Boolean(
    saveRequestId &&
    systemConfig?.configOperation?.commandId === saveRequestId &&
    systemConfig.configOperation.status === "pending",
  );
  const selectedRevision = useMemo(
    () => (selected ? JSON.stringify([selected.id, selected.enabled, selected.configuration?.value ?? {}]) : ""),
    [selected],
  );
  const configurationSections = useMemo(
    () =>
      projectSystemExtensionConfigurationSections({
        sections: selected?.configuration?.sections ?? [],
        locale,
        configSnapshot: systemConfig?.configSnapshot ?? null,
      }),
    [locale, selected?.configuration?.sections, systemConfig?.configSnapshot],
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (extensions.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!extensions.some((extension) => extension.id === selectedId)) setSelectedId(extensions[0]?.id ?? null);
  }, [extensions, selectedId]);

  useEffect(() => {
    if (!selected || dirty || saveRequestId) return;
    setEnabled(selected.enabled);
    setConfiguration(structuredClone(selected.configuration?.value ?? {}));
    setOperationError(null);
  }, [dirty, saveRequestId, selected, selectedRevision]);

  useEffect(() => {
    if (!saveRequestId || systemConfig?.configOperation?.commandId !== saveRequestId) return;
    if (systemConfig.configOperation.status === "success") {
      setSaveRequestId(null);
      setDirty(false);
      setOperationError(null);
      systemConfig.refreshToolSettings();
    } else if (systemConfig.configOperation.status === "error") {
      setSaveRequestId(null);
      setOperationError(systemConfig.configOperation.message ?? frontendMessage("settings.tools.saveFailed"));
    }
  }, [saveRequestId, systemConfig, systemConfig?.configOperation]);

  if (!systemConfig || !systemConfig.toolSettingsSynced.systemTools) {
    return <StateView status="loading" description={frontendMessage("settings.tools.loading")} />;
  }

  const updateDirtyState = (nextEnabled: boolean, nextConfiguration: Record<string, unknown>): void => {
    setEnabled(nextEnabled);
    setConfiguration(nextConfiguration);
    setDirty(
      Boolean(
        selected &&
        (nextEnabled !== selected.enabled || !sameJsonValue(nextConfiguration, selected.configuration?.value ?? {})),
      ),
    );
    setOperationError(null);
  };
  const discard = (): void => {
    if (!selected) return;
    setEnabled(selected.enabled);
    setConfiguration(structuredClone(selected.configuration?.value ?? {}));
    setDirty(false);
    setOperationError(null);
  };
  const save = (): void => {
    if (!selected || !systemConfig.configSnapshot) return;
    const snapshotValue = systemConfig.configSnapshot.value;
    const currentExtensions = isJsonConfigObject(snapshotValue.Extensions) ? snapshotValue.Extensions : {};
    const nextExtensions = structuredClone(currentExtensions);
    const entry: Record<string, unknown> = { Enabled: enabled };
    if (selected.configuration && Object.keys(configuration).length > 0) entry.Configuration = configuration;
    if (enabled && !selected.configuration && !selected.configured) delete nextExtensions[selected.id];
    else nextExtensions[selected.id] = entry;
    const requestId = systemConfig.saveConfig({ ...snapshotValue, Extensions: nextExtensions });
    if (!requestId) {
      setOperationError(frontendMessage("settings.tools.commandUnavailable"));
      return;
    }
    setSaveRequestId(requestId);
    setOperationError(null);
  };

  return (
    <section className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(180px,36%)_minmax(0,1fr)] overflow-hidden bg-paper-50 md:grid-cols-[272px_minmax(0,1fr)] md:grid-rows-1">
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
            disabled={!connected || saving}
            onClick={systemConfig.refreshToolSettings}
          >
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        </div>
        {extensions.length === 0 ? (
          <StateView
            status="empty"
            icon={<Package className="h-4 w-4 text-ink-400" />}
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
                  disabled={dirty || saving}
                  onSelect={() => {
                    setSelectedId(extension.id);
                    setEnabled(extension.enabled);
                    setConfiguration(structuredClone(extension.configuration?.value ?? {}));
                    setOperationError(null);
                  }}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
      {selected ? (
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex min-w-0 shrink-0 items-start justify-between gap-4 border-b border-ink-200/70 px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <h3 className="truncate text-[15px] font-semibold text-ink-900">{selectedDisplayName}</h3>
                <code className="truncate text-[10.5px] text-ink-400">{selected.id}</code>
              </div>
              <p className="mt-1 text-[11.5px] leading-5 text-ink-500">{selectedDescription}</p>
              <div className="mt-1 text-[10.5px] text-ink-400">
                {frontendMessage("settings.tools.packageMetadata", {
                  version: selected.version,
                  tools: selected.tools.length,
                  skills: selected.skillCount,
                  mcp: selected.mcpServerCount,
                })}
              </div>
            </div>
            <Switch
              checked={enabled}
              disabled={!connected || saving}
              ariaLabel={frontendMessage("settings.tools.enableExtension", { name: selectedDisplayName })}
              onCheckedChange={(next) => updateDirtyState(next, configuration)}
            />
          </div>
          <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
            {operationError ? <InlineError className="mx-4 mt-3 sm:mx-5">{operationError}</InlineError> : null}
            {selected.configuration ? (
              <JsonConfigSettingsView
                layoutMode="embedded"
                sections={configurationSections}
                value={configuration}
                disabled={!connected || saving}
                emptyText={frontendMessage("settings.tools.noConfiguration")}
                onChange={(next) => updateDirtyState(enabled, next)}
              />
            ) : (
              <div className="px-4 py-5 sm:px-6">
                <div className="mb-2 text-[12px] font-semibold text-ink-800">
                  {frontendMessage("settings.tools.contributedTools")}
                </div>
                {selected.tools.length > 0 ? (
                  <div className="divide-y divide-ink-200/70 border-y border-ink-200/70">
                    {selected.tools.map((tool) => (
                      <div key={tool.name} className="grid gap-2 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5">
                        <div className="min-w-0">
                          <div className="truncate text-[12.5px] font-semibold text-ink-850">{tool.name}</div>
                          <p className="mt-1 text-[11.5px] leading-5 text-ink-500">{tool.description}</p>
                        </div>
                        <code className="self-center truncate text-[10.5px] text-ink-400">{tool.capability}</code>
                      </div>
                    ))}
                  </div>
                ) : (
                  <StateView
                    status="empty"
                    icon={<Wrench className="h-4 w-4 text-ink-400" />}
                    title={frontendMessage("settings.tools.noTools")}
                  />
                )}
              </div>
            )}
          </ScrollArea>
          <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-ink-200/70 bg-paper-100 px-4 py-2.5 sm:px-5">
            <div className="text-[11px] text-ink-500" aria-live="polite">
              {saving
                ? frontendMessage("settings.tools.saving")
                : dirty
                  ? frontendMessage("settings.tools.unsaved")
                  : frontendMessage("settings.tools.saved")}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={discard}>
                <RotateCcw className="h-3.5 w-3.5" />
                {frontendMessage("settings.tools.discard")}
              </Button>
              <Button size="sm" disabled={!dirty || !connected || saving} onClick={save}>
                <Save className="h-3.5 w-3.5" />
                {frontendMessage("settings.tools.save")}
              </Button>
            </div>
          </div>
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
  disabled,
  onSelect,
}: {
  extension: SystemExtensionSettingsItem;
  locale: FrontendLocale;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}): JSX.Element {
  const displayName = resolveFrontendLocalizedText(extension.displayName, locale);
  return (
    <button
      type="button"
      disabled={disabled && !selected}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "grid min-h-[56px] w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
        selected
          ? "bg-accent-surface text-accent-content"
          : "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
        disabled && !selected && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{displayName}</span>
        <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-500">{extension.id}</span>
      </span>
      <span
        className={cn("h-2 w-2 rounded-full", extension.enabled ? "bg-accent-solid" : "bg-ink-300")}
        aria-label={frontendMessage(
          extension.enabled ? "settings.tools.status.enabled" : "settings.tools.status.disabled",
        )}
      />
    </button>
  );
}
