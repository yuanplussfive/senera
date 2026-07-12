import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BrainCircuit, RefreshCw, Save, Search } from "lucide-react";
import type { PluginConfigField, PluginConfigItem, PluginConfigMutationState } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { Button, Dialog, DialogContent, ScrollArea, Tooltip } from "../../shared/ui";
import {
  ConfigSourceNotice,
  Diagnostics,
  SettingsView,
  TomlView,
  type ConfigView,
  ViewSwitch,
} from "./PluginConfigViews";
import { parseDraftToml, validatePluginConfigDraft, writeDraftFieldValue } from "./pluginConfigDraft";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
export { readNumberDraftCommitValue, validatePluginConfigDraft, writeDraftFieldValue } from "./pluginConfigDraft";

export function PluginConfigControl({
  disabled,
  plugins,
  operations,
  onRefresh,
  onSave,
  onSetEnabled,
}: {
  disabled: boolean;
  plugins: PluginConfigItem[];
  operations: Record<string, PluginConfigMutationState>;
  onRefresh: () => void;
  onSave: (pluginName: string, toml: string) => string | null;
  onSetEnabled: (pluginName: string, enabled: boolean, toolName?: string) => string | null;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<ConfigView>("settings");
  const [filterText, setFilterText] = useState("");
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const [toggleRequestId, setToggleRequestId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const configurablePlugins = useMemo(() => plugins.filter((plugin) => plugin.rootKind === "User"), [plugins]);

  const selected = useMemo(
    () => configurablePlugins.find((plugin) => plugin.name === selectedName) ?? configurablePlugins[0] ?? null,
    [configurablePlugins, selectedName],
  );

  const activePlugins = configurablePlugins.filter((plugin) => plugin.available).length;
  const hasErrors = configurablePlugins.some((plugin) =>
    plugin.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
  );
  const needsConfiguration = configurablePlugins.some((plugin) => plugin.needsUserConfig);
  const filteredPlugins = useMemo(() => {
    const query = filterText.trim().toLocaleLowerCase();
    if (!query) {
      return configurablePlugins;
    }
    return configurablePlugins.filter((plugin) => pluginSearchText(plugin).includes(query));
  }, [configurablePlugins, filterText]);
  const parsedDraft = useMemo(() => parseDraftToml(draft), [draft]);
  const visibleSections = selected?.sections.filter((section) => section.fields.length > 0) ?? [];
  const draftValidationErrors = useMemo(
    () => (selected && parsedDraft.value ? validatePluginConfigDraft(selected.sections, parsedDraft.value) : []),
    [parsedDraft.value, selected],
  );
  const saveOperation = saveRequestId ? operations[saveRequestId] : undefined;
  const toggleOperation = toggleRequestId ? operations[toggleRequestId] : undefined;
  const saving = saveOperation?.status === "pending";
  const toggling = toggleOperation?.status === "pending";
  const hasDraftErrors = Boolean(parsedDraft.error) || draftValidationErrors.length > 0;

  useEffect(() => {
    if (!open) return;
    if (!selectedName && configurablePlugins.length > 0) {
      setSelectedName(configurablePlugins[0].name);
    }
  }, [configurablePlugins, open, selectedName]);

  useEffect(() => {
    if (!selected) {
      setDraft("");
      setDirty(false);
      setSaveRequestId(null);
      setToggleRequestId(null);
      setSaveError(null);
      return;
    }
    setDraft(selected.toml);
    setDirty(false);
    setSaveRequestId(null);
    setToggleRequestId(null);
    setSaveError(null);
    setView("settings");
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    if (saveOperation?.status === "success") {
      setDraft(selected.toml);
      setDirty(false);
      setSaveRequestId(null);
      setSaveError(null);
      return;
    }
    if (saveOperation?.status === "error") {
      setSaveRequestId(null);
      setSaveError(saveOperation.message ?? frontendMessage("pluginConfig.saveFailed"));
      return;
    }
    if (dirty) return;
    setDraft(selected.toml);
  }, [dirty, saveOperation?.message, saveOperation?.status, selected]);

  useEffect(() => {
    if (!toggleOperation) return;
    if (toggleOperation.status === "pending") return;
    setToggleRequestId(null);
  }, [toggleOperation]);

  const save = (): void => {
    if (!selected || !dirty || hasDraftErrors || saving) return;
    const requestId = onSave(selected.name, draft);
    if (!requestId) {
      return;
    }
    setSaveError(null);
    setSaveRequestId(requestId);
  };

  const updateDraft = (nextDraft: string): void => {
    setDraft(nextDraft);
    setDirty(Boolean(selected) && nextDraft !== selected?.toml);
    setSaveError(null);
  };

  const updateField = (field: PluginConfigField, value: unknown): void => {
    const nextDraft = writeDraftFieldValue(draft, field, value);
    updateDraft(nextDraft);
  };

  const selectPlugin = (pluginName: string): void => {
    if (pluginName === selected?.name) return;
    if (dirty && !confirmDiscardDirtyDraft()) return;
    setSelectedName(pluginName);
  };

  const setSelectedToolEnabled = (toolName: string, enabled: boolean): void => {
    if (!selected) return;
    const requestId = onSetEnabled(selected.name, enabled, toolName);
    if (requestId) {
      setToggleRequestId(requestId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip content={frontendMessage("pluginConfig.title")} side="top">
        <button
          type="button"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px]",
            "text-ink-500 transition hover:bg-ink-900/[0.045] hover:text-ink-800",
            "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
            disabled && "pointer-events-none opacity-55",
          )}
          aria-label={frontendMessage("pluginConfig.title")}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <BrainCircuit className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{frontendMessage("pluginConfig.shortTitle")}</span>
          {hasErrors || needsConfiguration ? (
            <AlertTriangle className={cn("h-3.5 w-3.5", hasErrors ? "text-brick-500" : "text-amber-500")} />
          ) : null}
        </button>
      </Tooltip>

      <DialogContent
        title={frontendMessage("pluginConfig.title")}
        description={frontendMessage("pluginConfig.description")}
        motionPreset="focus"
        className="h-[min(760px,calc(100dvh_-_16px))] max-h-none w-[min(1120px,calc(100vw_-_16px))] max-w-none rounded-lg bg-paper-100 sm:h-[min(760px,calc(100dvh_-_32px))] sm:w-[min(1120px,calc(100vw_-_32px))]"
        bodyClassName="flex min-h-0 flex-1 bg-paper-100"
      >
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-paper-100 lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <aside className="min-h-0 border-b border-ink-200/70 bg-paper-200/45 lg:border-b-0 lg:border-r">
            <div className="flex min-h-12 items-center justify-between gap-2 px-3 py-2 sm:px-4 lg:min-h-14">
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-ink-900">
                  {frontendMessage("pluginConfig.externalPlugins")}
                </div>
                <div className="mt-0.5 text-[11px] text-ink-500">
                  {frontendMessage("pluginConfig.availableCount", {
                    active: activePlugins,
                    total: configurablePlugins.length || 0,
                  })}
                </div>
              </div>
              <Tooltip content={frontendMessage("pluginConfig.refresh")} side="bottom">
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded-md text-ink-500 transition hover:bg-ink-900/[0.05] hover:text-ink-800"
                  onClick={onRefresh}
                  aria-label={frontendMessage("pluginConfig.refresh")}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>

            <div className="px-3 pb-2 lg:pb-2">
              <label className="flex h-8 items-center gap-2 rounded-lg border border-transparent bg-paper-50 px-2.5 text-ink-400 shadow-panel transition focus-within:border-terra-200 focus-within:ring-2 focus-within:ring-terra-100">
                <Search className="h-3.5 w-3.5 shrink-0" />
                <input
                  value={filterText}
                  onChange={(event) => setFilterText(event.currentTarget.value)}
                  placeholder={frontendMessage("pluginConfig.searchPlaceholder")}
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-800 outline-none placeholder:text-ink-400"
                />
              </label>
            </div>

            <ScrollArea className="h-[76px] overflow-x-auto lg:h-[calc(100%_-_104px)] lg:overflow-x-hidden">
              <div className="flex gap-1.5 px-2 pb-2 pt-1 lg:block lg:space-y-1 lg:pb-3">
                {filteredPlugins.map((plugin) => {
                  const active = selected?.name === plugin.name;
                  const error = plugin.diagnostics.some((diagnostic) => diagnostic.severity === "error");
                  return (
                    <button
                      key={plugin.name}
                      type="button"
                      className={cn(
                        "flex min-w-[172px] items-center gap-2 rounded-lg px-2.5 py-2 text-left transition lg:w-full lg:min-w-0 lg:gap-3 lg:px-3 lg:py-2.5",
                        active
                          ? "bg-paper-50 text-ink-900 shadow-panel"
                          : "text-ink-600 hover:bg-paper-50/70 hover:text-ink-900",
                      )}
                      onClick={() => selectPlugin(plugin.name)}
                    >
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          error
                            ? "bg-brick-500"
                            : plugin.needsUserConfig
                              ? "bg-amber-500"
                              : plugin.available
                                ? "bg-emerald-500"
                                : "bg-ink-300",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{pluginDisplayTitle(plugin)}</span>
                        <span
                          className={cn("mt-0.5 block truncate text-[11px]", active ? "text-ink-500" : "text-ink-400")}
                        >
                          {frontendMessage("pluginConfig.enabledToolCount", {
                            enabled: plugin.enabledToolCount,
                            total: plugin.toolCount,
                          })}
                        </span>
                      </span>
                      {active ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-terra-500" /> : null}
                    </button>
                  );
                })}
                {filteredPlugins.length === 0 ? (
                  <div className="w-full px-3 py-5 text-center text-[12px] text-ink-400 lg:py-8">
                    {frontendMessage("pluginConfig.noMatches")}
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden bg-paper-50">
            {selected ? (
              <>
                <div className="shrink-0 border-b border-ink-200/70 bg-paper-50/95 px-3 py-2.5 sm:px-5 sm:py-4">
                  <div className="mx-auto grid max-w-[820px] min-w-0 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
                    <div className="min-w-0 sm:flex-1">
                      <div className="truncate text-[16px] font-semibold text-ink-900 sm:text-[18px]">
                        {pluginDisplayTitle(selected)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-500">
                        <span>
                          {frontendMessage("pluginConfig.enabledToolCount", {
                            enabled: selected.enabledToolCount,
                            total: selected.toolCount,
                          })}
                        </span>
                        {saving ? (
                          <>
                            <span className="text-ink-300">/</span>
                            <span className="text-terra-700">{frontendMessage("pluginConfig.saving")}</span>
                          </>
                        ) : selected.needsUserConfig ? (
                          <>
                            <span className="text-ink-300">/</span>
                            <span className="text-amber-700">{frontendMessage("pluginConfig.needsConfiguration")}</span>
                          </>
                        ) : dirty ? (
                          <>
                            <span className="text-ink-300">/</span>
                            <span className="text-terra-700">{frontendMessage("pluginConfig.unsavedChanges")}</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <ViewSwitch value={view} onChange={setView} />
                      <TogglePill
                        enabled={selected.enabled}
                        disabled={dirty || toggling}
                        label={frontendMessage("pluginConfig.plugin")}
                        onClick={() => {
                          const requestId = onSetEnabled(selected.name, !selected.enabled);
                          if (requestId) {
                            setToggleRequestId(requestId);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!dirty || saving || hasDraftErrors}
                        onClick={save}
                        className="h-8"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {frontendMessage(saving ? "pluginConfig.saving" : "pluginConfig.save")}
                      </Button>
                    </div>
                  </div>

                  <Diagnostics
                    diagnostics={selected.diagnostics}
                    parseError={parsedDraft.error}
                    validationErrors={draftValidationErrors}
                    saveError={saveError}
                  />
                  <ConfigSourceNotice plugin={selected} />
                </div>

                {view === "settings" ? (
                  <SettingsView
                    plugin={selected}
                    sections={visibleSections}
                    parsedDraft={parsedDraft.value}
                    parseError={parsedDraft.error}
                    toolsDisabled={dirty || toggling || !selected.enabled}
                    onSetToolEnabled={setSelectedToolEnabled}
                    onUpdateField={updateField}
                  />
                ) : (
                  <TomlView draft={draft} onChange={updateDraft} />
                )}
              </>
            ) : (
              <div className="grid flex-1 place-items-center text-[13px] text-ink-400">
                {frontendMessage("pluginConfig.empty")}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TogglePill({
  enabled,
  disabled,
  label,
  onClick,
}: {
  enabled: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-1.5 text-[12px] transition",
        enabled ? "text-moss-600" : "text-ink-500",
        !disabled && "hover:bg-ink-900/[0.04]",
        disabled && "pointer-events-none opacity-45",
      )}
      aria-label={frontendMessage(enabled ? "pluginConfig.disableLabel" : "pluginConfig.enableLabel", { label })}
    >
      <span className={cn("relative h-5 w-9 rounded-full transition", enabled ? "bg-moss-500" : "bg-ink-300")}>
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
            enabled && "translate-x-4",
          )}
        />
      </span>
      <span>{frontendMessage(enabled ? "pluginConfig.enabled" : "pluginConfig.disabled")}</span>
    </button>
  );
}

function confirmDiscardDirtyDraft(): boolean {
  return window.confirm(frontendMessage("pluginConfig.discardConfirm"));
}

function pluginSearchText(plugin: PluginConfigItem): string {
  const fieldText = plugin.sections
    .flatMap((section) => [
      section.name,
      section.label,
      section.description ?? "",
      ...section.fields.flatMap((field) => [field.key, field.label, field.description ?? ""]),
    ])
    .join(" ");
  const toolText = plugin.tools.flatMap((tool) => [tool.name, tool.summary ?? ""]).join(" ");

  return [plugin.name, pluginDisplayTitle(plugin), plugin.description ?? "", toolText, fieldText]
    .join(" ")
    .toLocaleLowerCase();
}

function pluginDisplayTitle(plugin: PluginConfigItem): string {
  const title = plugin.title.trim();
  const name = plugin.name.trim();
  return title && title !== plugin.name ? title : name || frontendMessage("pluginConfig.unnamed");
}
