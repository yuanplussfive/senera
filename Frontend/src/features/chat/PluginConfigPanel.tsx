import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Search } from "lucide-react";
import type { PluginConfigField, PluginConfigItem, PluginConfigMutationState } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { Button, Dialog, DialogActionButton, DialogActions, DialogContent, ScrollArea, Tooltip } from "../../shared/ui";
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

export function PluginConfigContent({
  layoutMode = "panel",
  plugins,
  operations,
  onRefresh,
  onSave,
  onSetEnabled,
  onDirtyChange,
}: {
  layoutMode?: PluginConfigLayoutMode;
  plugins: PluginConfigItem[];
  operations: Record<string, PluginConfigMutationState>;
  onRefresh: () => void;
  onSave: (pluginName: string, toml: string) => string | null;
  onSetEnabled: (pluginName: string, enabled: boolean, toolName?: string) => string | null;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<ConfigView>("settings");
  const [filterText, setFilterText] = useState("");
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const [toggleRequestId, setToggleRequestId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingPluginName, setPendingPluginName] = useState<string | null>(null);
  const [compactDetailOpen, setCompactDetailOpen] = useState(false);
  const { ref: layoutRef, layout } = useObservedLayout<HTMLDivElement, "compact" | "standard" | "wide">(
    classifySettingsContentLayout,
    "standard",
  );

  const configurablePlugins = useMemo(() => plugins.filter((plugin) => plugin.rootKind === "User"), [plugins]);

  const selected = useMemo(
    () => configurablePlugins.find((plugin) => plugin.name === selectedName) ?? configurablePlugins[0] ?? null,
    [configurablePlugins, selectedName],
  );

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
  const saving = saveOperation?.status === "pending";
  const toggling = toggleOperation?.status === "pending";
  const hasDraftErrors = Boolean(parsedDraft.error) || draftValidationErrors.length > 0;
  const embedded = layoutMode === "embedded";
  const workspace = layoutMode === "workspace";
  const compactWorkspace = workspace && layout === "compact";

  useEffect(() => {
    if (!selectedName && configurablePlugins.length > 0) {
      setSelectedName(configurablePlugins[0].name);
    }
  }, [configurablePlugins, selectedName]);

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

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

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
    if (pluginName === selected?.name) {
      if (compactWorkspace) setCompactDetailOpen(true);
      return;
    }
    if (dirty) {
      setPendingPluginName(pluginName);
      return;
    }
    setSelectedName(pluginName);
    if (compactWorkspace) setCompactDetailOpen(true);
  };

  const setSelectedToolEnabled = (toolName: string, enabled: boolean): void => {
    if (!selected) return;
    const requestId = onSetEnabled(selected.name, enabled, toolName);
    if (requestId) {
      setToggleRequestId(requestId);
    }
  };

  return (
    <div
      ref={layoutRef}
      className={cn(
        "grid min-h-0 flex-1 grid-cols-1 bg-paper-100",
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
            "min-h-0 border-b border-ink-200/70 bg-paper-200/45",
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
            <label className="flex h-8 items-center gap-2 rounded-lg border border-transparent bg-paper-50 px-2.5 text-ink-400 shadow-panel transition focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <input
                value={filterText}
                onChange={(event) => setFilterText(event.currentTarget.value)}
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
        <section className={cn("flex min-h-0 flex-col bg-paper-50", embedded ? "overflow-visible" : "overflow-hidden")}>
          {compactWorkspace ? (
            <button
              type="button"
              className="flex h-11 shrink-0 items-center gap-2 border-b border-ink-200/70 px-3 text-[12.5px] font-medium text-ink-600"
              onClick={() => {
                if (dirty) {
                  setPendingPluginName("__back__");
                  return;
                }
                setCompactDetailOpen(false);
              }}
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
                  layoutMode={layoutMode}
                  plugin={selected}
                  sections={visibleSections}
                  parsedDraft={parsedDraft.value}
                  parseError={parsedDraft.error}
                  toolsDisabled={dirty || toggling || !selected.enabled}
                  onSetToolEnabled={setSelectedToolEnabled}
                  onUpdateField={updateField}
                />
              ) : (
                <TomlView layoutMode={layoutMode} draft={draft} onChange={updateDraft} />
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-[13px] text-ink-400">
              {frontendMessage("runtime.migrated.features.chat.PluginConfigPanel.328.13")}
            </div>
          )}
        </section>
      ) : null}
      <Dialog open={pendingPluginName !== null} onOpenChange={(open) => !open && setPendingPluginName(null)}>
        <DialogContent
          title={frontendMessage("pluginConfig.discardTitle")}
          description={frontendMessage("pluginConfig.discardDescription")}
        >
          <DialogActions>
            <DialogActionButton close>{frontendMessage("pluginConfig.discardContinue")}</DialogActionButton>
            <DialogActionButton
              variant="danger"
              onClick={() => {
                const target = pendingPluginName;
                setPendingPluginName(null);
                setDirty(false);
                setSaveError(null);
                if (selected) setDraft(selected.toml);
                if (target === "__back__") {
                  setCompactDetailOpen(false);
                } else if (target) {
                  setSelectedName(target);
                  if (compactWorkspace) setCompactDetailOpen(true);
                }
              }}
            >
              {frontendMessage("pluginConfig.discardAction")}
            </DialogActionButton>
          </DialogActions>
        </DialogContent>
      </Dialog>
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
              "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition",
              embedded
                ? "min-w-0 lg:gap-3 lg:px-3 lg:py-2.5"
                : workspace
                  ? "w-full min-w-0 gap-3 px-3 py-2.5"
                  : "min-w-[172px] lg:w-full lg:min-w-0 lg:gap-3 lg:px-3 lg:py-2.5",
              active ? "bg-paper-50 text-ink-900 shadow-panel" : "text-ink-600 hover:bg-paper-50/70 hover:text-ink-900",
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
            {active ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-solid" /> : null}
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
