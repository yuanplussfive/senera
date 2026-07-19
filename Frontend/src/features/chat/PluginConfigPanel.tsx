import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, RotateCcw, Search } from "lucide-react";
import type { PluginConfigField, PluginConfigItem, PluginConfigMutationState } from "../../api/eventTypes";
import type { SocketStatus } from "../../api/useAgentSocket";
import { cn } from "../../lib/util";
import { Button, ScrollArea, Switch, Tooltip } from "../../shared/ui";
import {
  ConfigSourceNotice,
  Diagnostics,
  SettingsView,
  TomlView,
  type ConfigView,
  type PluginConfigLayoutMode,
  ViewSwitch,
} from "./PluginConfigViews";
import { parseDraftToml, validatePluginConfigDraft, writeDraftFieldValue } from "./pluginConfigDraft";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { classifySettingsContentLayout, useObservedLayout } from "../../shared/responsive";
export { readNumberDraftCommitValue, validatePluginConfigDraft, writeDraftFieldValue } from "./pluginConfigDraft";

const AUTO_SAVE_DELAY_MS = 500;

interface PluginDraftEntry {
  synced: string;
  draft: string;
  dirty: boolean;
  saveRequestId: string | null;
  saveRequestDraft: string | null;
  queuedDraft: string | null;
  awaitingSnapshot: string | null;
  saveError: string | null;
  autoSaveBlocked: boolean;
  toggleRequestId: string | null;
}

function createPluginDraftEntry(plugin: PluginConfigItem): PluginDraftEntry {
  return {
    synced: plugin.toml,
    draft: plugin.toml,
    dirty: false,
    saveRequestId: null,
    saveRequestDraft: null,
    queuedDraft: null,
    awaitingSnapshot: null,
    saveError: null,
    autoSaveBlocked: false,
    toggleRequestId: null,
  };
}

export function PluginConfigContent({
  layoutMode = "panel",
  plugins,
  operations,
  socketStatus = "open",
  onRefresh,
  onSave,
  onSetEnabled,
  onDirtyChange,
}: {
  layoutMode?: PluginConfigLayoutMode;
  plugins: PluginConfigItem[];
  operations: Record<string, PluginConfigMutationState>;
  socketStatus?: SocketStatus;
  onRefresh: () => void;
  onSave: (pluginName: string, toml: string) => string | null;
  onSetEnabled: (pluginName: string, enabled: boolean, toolName?: string) => string | null;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [view, setView] = useState<ConfigView>("settings");
  const [filterText, setFilterText] = useState("");
  const [compactDetailOpen, setCompactDetailOpen] = useState(false);
  const [, setEntryVersion] = useState(0);
  const draftEntriesRef = useRef<Map<string, PluginDraftEntry>>(new Map());
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const configurablePluginsRef = useRef<PluginConfigItem[]>([]);
  const { ref: layoutRef, layout } = useObservedLayout<HTMLDivElement, "compact" | "standard" | "wide">(
    classifySettingsContentLayout,
    "standard",
  );

  const configurablePlugins = useMemo(() => plugins.filter((plugin) => plugin.rootKind === "User"), [plugins]);
  configurablePluginsRef.current = configurablePlugins;

  const selected = useMemo(
    () => configurablePlugins.find((plugin) => plugin.name === selectedName) ?? configurablePlugins[0] ?? null,
    [configurablePlugins, selectedName],
  );
  const selectedEntry = selected
    ? (draftEntriesRef.current.get(selected.name) ??
      (() => {
        const entry = createPluginDraftEntry(selected);
        draftEntriesRef.current.set(selected.name, entry);
        return entry;
      })())
    : null;
  const draft = selectedEntry?.draft ?? selected?.toml ?? "";
  const dirty = Boolean(selectedEntry?.dirty);
  const saveRequestId = selectedEntry?.saveRequestId ?? null;
  const toggleRequestId = selectedEntry?.toggleRequestId ?? null;
  const saveError = selectedEntry?.saveError ?? null;

  const activePlugins = configurablePlugins.filter((plugin) => plugin.available).length;
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
  const saving = saveRequestId !== null && saveOperation?.status !== "success" && saveOperation?.status !== "error";
  const toggling = toggleOperation?.status === "pending";
  const hasDraftErrors = Boolean(parsedDraft.error) || draftValidationErrors.length > 0;
  const embedded = layoutMode === "embedded";
  const workspace = layoutMode === "workspace";
  const compactWorkspace = workspace && layout === "compact";

  useEffect(() => {
    const selectionStillExists = configurablePlugins.some((plugin) => plugin.name === selectedName);
    const nextSelectedName = selectionStillExists ? selectedName : (configurablePlugins[0]?.name ?? null);
    if (nextSelectedName !== selectedName) {
      setSelectedName(nextSelectedName);
    }
  }, [configurablePlugins, selectedName]);

  useEffect(() => {
    let changed = false;
    const activeNames = new Set(configurablePlugins.map((plugin) => plugin.name));
    for (const plugin of configurablePlugins) {
      const current = draftEntriesRef.current.get(plugin.name);
      if (!current) {
        draftEntriesRef.current.set(plugin.name, createPluginDraftEntry(plugin));
        changed = true;
        continue;
      }
      if (current.awaitingSnapshot) {
        if (current.awaitingSnapshot !== plugin.toml) continue;
        draftEntriesRef.current.set(plugin.name, {
          ...current,
          synced: plugin.toml,
          draft: current.draft === current.awaitingSnapshot ? plugin.toml : current.draft,
          awaitingSnapshot: null,
        });
        changed = true;
        continue;
      }
      if (!current.dirty && !current.saveRequestId && !current.queuedDraft && current.synced !== plugin.toml) {
        draftEntriesRef.current.set(plugin.name, {
          ...current,
          synced: plugin.toml,
          draft: plugin.toml,
        });
        changed = true;
      }
    }
    for (const name of draftEntriesRef.current.keys()) {
      if (!activeNames.has(name)) {
        draftEntriesRef.current.delete(name);
        const timer = saveTimersRef.current.get(name);
        if (timer !== undefined) window.clearTimeout(timer);
        saveTimersRef.current.delete(name);
        changed = true;
      }
    }
    if (changed) setEntryVersion((version) => version + 1);
  }, [configurablePlugins]);

  const saveDraft = useCallback(
    (pluginName: string, manual: boolean): void => {
      const plugin = configurablePluginsRef.current.find((item) => item.name === pluginName);
      const current = plugin ? draftEntriesRef.current.get(pluginName) : undefined;
      if (!plugin || !current || !current.dirty) return;
      const parsed = parseDraftToml(current.draft);
      const validationErrors = parsed.value ? validatePluginConfigDraft(plugin.sections, parsed.value) : [];
      if (parsed.error || validationErrors.length > 0) return;
      if (current.saveRequestId) {
        draftEntriesRef.current.set(pluginName, { ...current, queuedDraft: current.draft });
        setEntryVersion((version) => version + 1);
        return;
      }
      if (!manual && current.autoSaveBlocked) return;
      if (socketStatus !== "open") {
        draftEntriesRef.current.set(pluginName, {
          ...current,
          saveError: frontendMessage("settings.draft.connectionInterrupted"),
          autoSaveBlocked: true,
        });
        setEntryVersion((version) => version + 1);
        return;
      }
      const requestId = onSave(pluginName, current.draft);
      if (!requestId) {
        draftEntriesRef.current.set(pluginName, {
          ...current,
          saveError: frontendMessage("pluginConfig.saveDisconnected"),
          autoSaveBlocked: true,
        });
        setEntryVersion((version) => version + 1);
        return;
      }
      draftEntriesRef.current.set(pluginName, {
        ...current,
        saveRequestId: requestId,
        saveRequestDraft: current.draft,
        queuedDraft: null,
        awaitingSnapshot: null,
        saveError: null,
        autoSaveBlocked: false,
      });
      setEntryVersion((version) => version + 1);
    },
    [onSave, socketStatus],
  );

  useEffect(() => {
    let changed = false;
    const followUps: string[] = [];
    for (const [pluginName, current] of draftEntriesRef.current) {
      if (current.saveRequestId === null) {
        if (current.toggleRequestId && operations[current.toggleRequestId]?.status !== "pending") {
          draftEntriesRef.current.set(pluginName, { ...current, toggleRequestId: null });
          changed = true;
        }
        continue;
      }
      const operation = operations[current.saveRequestId];
      if (!operation || operation.status === "pending") continue;
      if (operation.status === "error") {
        draftEntriesRef.current.set(pluginName, {
          ...current,
          saveRequestId: null,
          saveRequestDraft: null,
          queuedDraft: null,
          saveError: operation.message ?? frontendMessage("pluginConfig.saveFailed"),
          autoSaveBlocked: true,
        });
        changed = true;
        continue;
      }
      const sentDraft = current.saveRequestDraft ?? current.draft;
      const queuedDraft = current.queuedDraft;
      const latestPlugin = configurablePluginsRef.current.find((plugin) => plugin.name === pluginName);
      const snapshotMatchesRequest = latestPlugin?.toml === sentDraft;
      const nextDraft = queuedDraft ?? sentDraft;
      draftEntriesRef.current.set(pluginName, {
        ...current,
        synced: sentDraft,
        draft: nextDraft,
        dirty: nextDraft !== sentDraft,
        saveRequestId: null,
        saveRequestDraft: null,
        queuedDraft: null,
        awaitingSnapshot:
          queuedDraft !== null && queuedDraft !== sentDraft ? null : snapshotMatchesRequest ? null : sentDraft,
        saveError: null,
        autoSaveBlocked: false,
      });
      changed = true;
      if (queuedDraft !== null && queuedDraft !== sentDraft) followUps.push(pluginName);
    }
    if (changed) setEntryVersion((version) => version + 1);
    for (const pluginName of followUps) {
      window.setTimeout(() => saveDraft(pluginName, false), 0);
    }
  }, [operations, saveDraft]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const scheduleSave = useCallback(
    (pluginName: string, delay: number): void => {
      const previous = saveTimersRef.current.get(pluginName);
      if (previous !== undefined) window.clearTimeout(previous);
      const timer = window.setTimeout(() => {
        saveTimersRef.current.delete(pluginName);
        saveDraft(pluginName, false);
      }, delay);
      saveTimersRef.current.set(pluginName, timer);
    },
    [saveDraft],
  );

  const flushSave = useCallback((): void => {
    if (selected) saveDraft(selected.name, true);
  }, [saveDraft, selected]);
  const retrySave = flushSave;

  const updateDraft = (nextDraft: string, mode: "debounced" | "immediate" = "debounced"): void => {
    if (!selected) return;
    const current = selectedEntry ?? createPluginDraftEntry(selected);
    draftEntriesRef.current.set(selected.name, {
      ...current,
      draft: nextDraft,
      dirty: nextDraft !== current.synced,
      queuedDraft: current.saveRequestId ? nextDraft : current.queuedDraft,
      saveError: null,
      autoSaveBlocked: false,
    });
    setEntryVersion((version) => version + 1);
    scheduleSave(selected.name, mode === "immediate" ? 0 : AUTO_SAVE_DELAY_MS);
  };

  const updateField = (field: PluginConfigField, value: unknown): void => {
    const nextDraft = writeDraftFieldValue(draft, field, value);
    updateDraft(nextDraft, field.type === "boolean" || Boolean(field.options?.length) ? "immediate" : "debounced");
  };

  const selectPlugin = (pluginName: string): void => {
    if (pluginName === selected?.name) {
      if (compactWorkspace) setCompactDetailOpen(true);
      return;
    }
    setSelectedName(pluginName);
    if (compactWorkspace) setCompactDetailOpen(true);
  };

  const setSelectedToolEnabled = (toolName: string, enabled: boolean): void => {
    setPluginEnabled(enabled, toolName);
  };

  const setPluginEnabled = (enabled: boolean, toolName?: string): void => {
    if (!selected) return;
    const requestId = onSetEnabled(selected.name, enabled, toolName);
    if (requestId) {
      const current = selectedEntry ?? createPluginDraftEntry(selected);
      draftEntriesRef.current.set(selected.name, { ...current, toggleRequestId: requestId });
      setEntryVersion((version) => version + 1);
    }
  };

  return (
    <div
      ref={layoutRef}
      className={cn(
        "grid min-h-0 min-w-0 flex-1 grid-cols-1 bg-paper-100",
        embedded && "grid-rows-[auto_auto] overflow-visible",
        !embedded &&
          !workspace &&
          "grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]",
        workspace && "h-full overflow-hidden",
        workspace && layout === "standard" && "grid-cols-[230px_minmax(0,1fr)]",
        workspace && layout === "wide" && "grid-cols-[250px_minmax(0,1fr)]",
      )}
    >
      {!compactWorkspace || !compactDetailOpen ? (
        <aside
          className={cn(
            "min-h-0 min-w-0 border-b border-ink-200/70 bg-paper-200/45",
            !embedded && !workspace && "lg:border-b-0 lg:border-r",
            workspace && layout !== "compact" && "border-b-0 border-r",
          )}
        >
          <div className="flex min-h-12 items-center justify-between gap-2 px-3 py-2 sm:px-4 lg:min-h-14">
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-ink-900">
                {frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.187.71")}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-500">
                {activePlugins}/{configurablePlugins.length || 0}{" "}
                {frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.189.65")}
              </div>
            </div>
            <Tooltip content={frontendMessage("pluginConfig.syncTitle")} side="bottom">
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-[11.5px] text-ink-500 transition hover:bg-ink-900/[0.05] hover:text-ink-800",
                  layout === "compact" && "w-8 px-0",
                )}
                onClick={onRefresh}
                aria-label={frontendMessage("pluginConfig.syncTitle")}
              >
                <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                <span className={cn(layout === "compact" && "sr-only")}>{frontendMessage("pluginConfig.sync")}</span>
              </button>
            </Tooltip>
          </div>

          <div className="px-3 pb-2 lg:pb-2">
            <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-paper-50 px-2.5 text-ink-400 transition focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <input
                value={filterText}
                onChange={(event) => setFilterText(event.currentTarget.value)}
                aria-label={frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.210.27")}
                placeholder={frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.210.27")}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-800 outline-none placeholder:text-ink-400"
              />
            </label>
          </div>

          {embedded ? (
            <div className="grid gap-2 px-3 pb-3 pt-1 sm:grid-cols-2 sm:px-4 xl:grid-cols-4">
              <PluginSelectorRows
                layoutMode={layoutMode}
                selectedName={selected?.name ?? null}
                plugins={filteredPlugins}
                onSelect={selectPlugin}
              />
            </div>
          ) : (
            <ScrollArea
              className={cn(
                workspace
                  ? "h-[calc(100%_-_104px)]"
                  : "h-[76px] overflow-x-auto lg:h-[calc(100%_-_104px)] lg:overflow-x-hidden",
              )}
            >
              <div
                className={cn(
                  "gap-1.5 px-2 pb-2 pt-1",
                  workspace ? "block space-y-1 pb-3" : "flex lg:block lg:space-y-1 lg:pb-3",
                )}
              >
                <PluginSelectorRows
                  layoutMode={layoutMode}
                  selectedName={selected?.name ?? null}
                  plugins={filteredPlugins}
                  onSelect={selectPlugin}
                />
              </div>
            </ScrollArea>
          )}
        </aside>
      ) : null}

      {!compactWorkspace || compactDetailOpen ? (
        <section
          className={cn(
            "plugin-config-detail flex min-h-0 min-w-0 flex-col bg-paper-50",
            embedded ? "overflow-visible" : "overflow-hidden",
          )}
        >
          {compactWorkspace ? (
            <button
              type="button"
              className="flex h-11 shrink-0 items-center gap-2 border-b border-ink-200/70 px-3 text-[12.5px] font-medium text-ink-600"
              onClick={() => setCompactDetailOpen(false)}
            >
              {frontendMessage("pluginConfig.backToList")}
            </button>
          ) : null}
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
                        {selected.enabledToolCount}/{selected.toolCount}{" "}
                        {frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.252.76")}
                      </span>
                      {saving ? (
                        <>
                          <span className="text-ink-300">/</span>
                          <span className="text-accent-content">
                            {frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.256.58")}
                          </span>
                        </>
                      ) : selected.needsUserConfig ? (
                        <>
                          <span className="text-ink-300">/</span>
                          <span className="text-umber-600">
                            {frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.261.58")}
                          </span>
                        </>
                      ) : dirty ? (
                        <>
                          <span className="text-ink-300">/</span>
                          <span className="text-accent-content">
                            {frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.266.58")}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <ViewSwitch value={view} onChange={setView} />
                    <TogglePill
                      enabled={selected.enabled}
                      disabled={dirty || toggling}
                      label={frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.277.27")}
                      onClick={() => setPluginEnabled(!selected.enabled)}
                    />
                    {saveError && dirty ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={saving || hasDraftErrors || socketStatus !== "open"}
                        onClick={retrySave}
                        className="h-8"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {frontendMessage("settings.action.retry")}
                      </Button>
                    ) : null}
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
                  layoutMode={layoutMode}
                  plugin={selected}
                  sections={visibleSections}
                  parsedDraft={parsedDraft.value}
                  parseError={parsedDraft.error}
                  toolsDisabled={dirty || toggling || !selected.enabled}
                  onSetToolEnabled={setSelectedToolEnabled}
                  onUpdateField={updateField}
                  onCommit={flushSave}
                />
              ) : (
                <TomlView layoutMode={layoutMode} draft={draft} onChange={updateDraft} onCommit={flushSave} />
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-[13px] text-ink-400">
              {frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.328.13")}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function PluginSelectorRows({
  layoutMode,
  selectedName,
  plugins,
  onSelect,
}: {
  layoutMode: PluginConfigLayoutMode;
  selectedName: string | null;
  plugins: PluginConfigItem[];
  onSelect: (pluginName: string) => void;
}): JSX.Element {
  const embedded = layoutMode === "embedded";
  const workspace = layoutMode === "workspace";

  return (
    <>
      {plugins.map((plugin) => {
        const active = selectedName === plugin.name;
        const error = plugin.diagnostics.some((diagnostic) => diagnostic.severity === "error");
        return (
          <button
            key={plugin.name}
            type="button"
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-2 text-left transition",
              embedded
                ? "min-w-0 lg:gap-3 lg:px-3 lg:py-2.5"
                : workspace
                  ? "w-full min-w-0 gap-3 px-3 py-2.5"
                  : "min-w-[172px] lg:w-full lg:min-w-0 lg:gap-3 lg:px-3 lg:py-2.5",
              active
                ? "bg-ink-900/[0.055] text-ink-900"
                : "text-ink-600 hover:bg-paper-50/70 hover:text-ink-900",
            )}
            onClick={() => onSelect(plugin.name)}
          >
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                error
                  ? "bg-brick-500"
                  : plugin.needsUserConfig
                    ? "bg-umber-500"
                    : plugin.available
                      ? "bg-moss-500"
                      : "bg-ink-300",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{pluginDisplayTitle(plugin)}</span>
              <span className={cn("mt-0.5 block truncate text-[11px]", active ? "text-ink-500" : "text-ink-400")}>
                {plugin.enabledToolCount}/{plugin.toolCount}{" "}
                {frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.391.62")}
              </span>
            </span>
          </button>
        );
      })}
      {plugins.length === 0 ? (
        <div className="w-full px-3 py-5 text-center text-[12px] text-ink-400 lg:py-8">
          {frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.402.11")}
        </div>
      ) : null}
    </>
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
    <Switch
      checked={enabled}
      disabled={disabled}
      ariaLabel={frontendMessage(enabled ? "pluginConfig.disableLabel" : "pluginConfig.enableLabel", { label })}
      onCheckedChange={() => onClick()}
    />
  );
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
