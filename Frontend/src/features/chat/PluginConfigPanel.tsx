import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  Code2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  parse as parseToml,
  stringify as stringifyToml,
  type TomlTableWithoutBigInt,
} from "smol-toml";
import type {
  PluginConfigField,
  PluginConfigFieldOptionValue,
  PluginConfigItem,
  PluginConfigMutationState,
  PluginConfigSection,
} from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { Button, Dialog, DialogContent, ScrollArea, Tooltip } from "../../shared/ui";

type ConfigView = "settings" | "toml";
type EditableTomlTable = Record<string, unknown>;

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

  const configurablePlugins = useMemo(
    () => plugins.filter((plugin) => plugin.rootKind === "User"),
    [plugins],
  );

  const selected = useMemo(
    () => configurablePlugins.find((plugin) => plugin.name === selectedName)
      ?? configurablePlugins[0]
      ?? null,
    [configurablePlugins, selectedName],
  );

  const activePlugins = configurablePlugins.filter((plugin) => plugin.available).length;
  const hasErrors = configurablePlugins.some((plugin) =>
    plugin.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  );
  const needsConfiguration = configurablePlugins.some((plugin) => plugin.needsUserConfig);
  const filteredPlugins = useMemo(() => {
    const query = filterText.trim().toLocaleLowerCase();
    if (!query) {
      return configurablePlugins;
    }
    return configurablePlugins.filter((plugin) =>
      pluginSearchText(plugin).includes(query)
    );
  }, [configurablePlugins, filterText]);
  const parsedDraft = useMemo(() => parseDraftToml(draft), [draft]);
  const visibleSections = selected?.sections.filter((section) => section.fields.length > 0) ?? [];
  const draftValidationErrors = useMemo(
    () => selected && parsedDraft.value
      ? validatePluginConfigDraft(selected.sections, parsedDraft.value)
      : [],
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
  }, [selected?.name]);

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
      setSaveError(saveOperation.message ?? "保存失败");
      return;
    }
    if (dirty) return;
    setDraft(selected.toml);
  }, [dirty, saveOperation?.message, saveOperation?.status, selected?.toml]);

  useEffect(() => {
    if (!toggleOperation) return;
    if (toggleOperation.status === "pending") return;
    setToggleRequestId(null);
  }, [toggleOperation?.status]);

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
      <Tooltip content="技能配置" side="top">
        <button
          type="button"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px]",
            "text-ink-500 transition hover:bg-ink-900/[0.045] hover:text-ink-800",
            "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
            disabled && "pointer-events-none opacity-55",
          )}
          aria-label="技能配置"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <BrainCircuit className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">技能</span>
          {hasErrors || needsConfiguration ? (
            <AlertTriangle className={cn("h-3.5 w-3.5", hasErrors ? "text-brick-500" : "text-amber-500")} />
          ) : null}
        </button>
      </Tooltip>

      <DialogContent
        title="技能配置"
        description="外部技能参数"
        motionPreset="focus"
        className="h-[min(760px,calc(100dvh_-_16px))] max-h-none w-[min(1120px,calc(100vw_-_16px))] max-w-none rounded-lg bg-paper-100 sm:h-[min(760px,calc(100dvh_-_32px))] sm:w-[min(1120px,calc(100vw_-_32px))]"
        bodyClassName="flex min-h-0 flex-1 bg-paper-100"
      >
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-paper-100 lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <aside className="min-h-0 border-b border-ink-200/70 bg-paper-200/45 lg:border-b-0 lg:border-r">
            <div className="flex min-h-12 items-center justify-between gap-2 px-3 py-2 sm:px-4 lg:min-h-14">
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-ink-900">外部技能</div>
                <div className="mt-0.5 text-[11px] text-ink-500">
                  {activePlugins}/{configurablePlugins.length || 0} 可用
                </div>
              </div>
              <Tooltip content="刷新技能配置" side="bottom">
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded-md text-ink-500 transition hover:bg-ink-900/[0.05] hover:text-ink-800"
                  onClick={onRefresh}
                  aria-label="刷新技能配置"
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
                  placeholder="搜索技能..."
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
                        <span className="block truncate text-[13px] font-medium">
                          {pluginDisplayTitle(plugin)}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 block truncate text-[11px]",
                            active ? "text-ink-500" : "text-ink-400",
                          )}
                        >
                          {plugin.enabledToolCount}/{plugin.toolCount} 个技能启用
                        </span>
                      </span>
                      {active ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-terra-500" />
                      ) : null}
                    </button>
                  );
                })}
                {filteredPlugins.length === 0 ? (
                  <div className="w-full px-3 py-5 text-center text-[12px] text-ink-400 lg:py-8">
                    没有匹配的技能
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
                        <span>{selected.enabledToolCount}/{selected.toolCount} 个技能启用</span>
                        {saving ? (
                          <>
                            <span className="text-ink-300">/</span>
                            <span className="text-terra-700">正在保存</span>
                          </>
                        ) : selected.needsUserConfig ? (
                          <>
                            <span className="text-ink-300">/</span>
                            <span className="text-amber-700">需要配置</span>
                          </>
                        ) : dirty ? (
                          <>
                            <span className="text-ink-300">/</span>
                            <span className="text-terra-700">有未保存修改</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <ViewSwitch value={view} onChange={setView} />
                      <TogglePill
                        enabled={selected.enabled}
                        disabled={dirty || toggling}
                        label="技能"
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
                        {saving ? "正在保存" : "保存"}
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
                  <TomlView
                    draft={draft}
                    onChange={updateDraft}
                  />
                )}
              </>
            ) : (
              <div className="grid flex-1 place-items-center text-[13px] text-ink-400">
                未发现外部技能配置
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ViewSwitch({
  value,
  onChange,
}: {
  value: ConfigView;
  onChange: (value: ConfigView) => void;
}): JSX.Element {
  const items: Array<{ value: ConfigView; label: string; icon: JSX.Element }> = [
    { value: "settings", label: "设置", icon: <Settings2 className="h-3.5 w-3.5" /> },
    { value: "toml", label: "源码", icon: <Code2 className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="grid h-8 grid-cols-2 rounded-lg bg-ink-900/[0.055] p-1">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md px-2 text-[12px] transition",
            value === item.value
              ? "bg-paper-50 text-ink-900 shadow-sm"
              : "text-ink-500 hover:text-ink-800",
          )}
          onClick={() => onChange(item.value)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function SettingsView({
  plugin,
  sections,
  parsedDraft,
  parseError,
  toolsDisabled,
  onSetToolEnabled,
  onUpdateField,
}: {
  plugin: PluginConfigItem;
  sections: PluginConfigSection[];
  parsedDraft?: TomlTableWithoutBigInt;
  parseError?: string;
  toolsDisabled: boolean;
  onSetToolEnabled: (toolName: string, enabled: boolean) => void;
  onUpdateField: (field: PluginConfigField, value: unknown) => void;
}): JSX.Element {
  return (
    <ScrollArea className="min-h-0 flex-1 bg-paper-50">
      <div className="mx-auto min-h-full w-full max-w-[820px] px-4 py-5 sm:px-5 sm:py-8">
        {parseError ? (
          <div className="mb-5 rounded-xl border border-brick-100 bg-brick-50 px-3 py-2 text-[12.5px] text-brick-700">
            配置源码解析失败，修复后才能使用设置视图。
          </div>
        ) : null}

        {sections.length > 0 ? (
          <div className={cn("space-y-7", parseError && "opacity-60")}>
            <PluginToolsSection
              plugin={plugin}
              disabled={toolsDisabled || Boolean(parseError)}
              onSetToolEnabled={onSetToolEnabled}
            />
            {sections.map((section, sectionIndex) => (
              <SettingsSection
                key={section.name}
                section={section}
                sectionIndex={sectionIndex}
                parsedDraft={parsedDraft}
                disabled={Boolean(parseError)}
                onUpdateField={onUpdateField}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-7">
            <PluginToolsSection
              plugin={plugin}
              disabled={toolsDisabled || Boolean(parseError)}
              onSetToolEnabled={onSetToolEnabled}
            />
            <div className="grid min-h-64 place-items-center rounded-xl border border-ink-200/70 bg-paper-50 text-[13px] text-ink-400 shadow-panel">
              该技能没有可视化配置项
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function PluginToolsSection({
  plugin,
  disabled,
  onSetToolEnabled,
}: {
  plugin: PluginConfigItem;
  disabled: boolean;
  onSetToolEnabled: (toolName: string, enabled: boolean) => void;
}): JSX.Element | null {
  if (plugin.tools.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="mb-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 px-0.5">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-ink-900">工具开关</h3>
          <p className="mt-0.5 text-[12px] leading-5 text-ink-500">
            控制该插件下每个工具是否参与外部工具集。
          </p>
        </div>
        <span className="pb-0.5 text-[11px] text-ink-400">
          {plugin.enabledToolCount}/{plugin.toolCount} 项
        </span>
      </div>
      <div className="divide-y divide-ink-200/70 overflow-hidden rounded-xl border border-ink-200/70 bg-paper-50 shadow-panel">
        {plugin.tools.map((tool) => (
          <div
            key={tool.name}
            className="grid min-w-0 gap-3 px-4 py-3.5 transition hover:bg-paper-100/45 md:grid-cols-[minmax(220px,1fr)_auto] md:items-center"
          >
            <div className="min-w-0 pr-2">
              <div className="truncate text-[13px] font-medium text-ink-900">{tool.name}</div>
              {tool.summary ? (
                <p className="mt-1 text-[12px] leading-5 text-ink-500">{tool.summary}</p>
              ) : null}
            </div>
            <TogglePill
              enabled={tool.enabled}
              disabled={disabled}
              label={tool.name}
              onClick={() => onSetToolEnabled(tool.name, !tool.enabled)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsSection({
  section,
  sectionIndex,
  parsedDraft,
  disabled,
  onUpdateField,
}: {
  section: PluginConfigSection;
  sectionIndex: number;
  parsedDraft?: TomlTableWithoutBigInt;
  disabled: boolean;
  onUpdateField: (field: PluginConfigField, value: unknown) => void;
}): JSX.Element {
  return (
    <section>
      <div className="mb-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 px-0.5">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-ink-900">
            {sectionDisplayTitle(section, sectionIndex)}
          </h3>
          {section.description ? (
            <p className="mt-0.5 text-[12px] leading-5 text-ink-500">
              {section.description}
            </p>
          ) : null}
        </div>
        <span className="pb-0.5 text-[11px] text-ink-400">{section.fields.length} 项</span>
      </div>
      <div className="divide-y divide-ink-200/70 overflow-hidden rounded-xl border border-ink-200/70 bg-paper-50 shadow-panel">
        {section.fields.map((field) => (
          <FieldControl
            key={field.path.join(".")}
            field={field}
            value={readDraftValue(parsedDraft, field)}
            disabled={disabled}
            onChange={(value) => onUpdateField(field, value)}
          />
        ))}
      </div>
    </section>
  );
}

function sectionDisplayTitle(section: PluginConfigSection, sectionIndex: number): string {
  return section.label ?? (sectionIndex === 0 ? "基础设置" : "参数设置");
}

function FieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PluginConfigField;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const label = field.label ?? "未命名参数";
  return (
    <div
      className={cn(
        "grid min-w-0 gap-3 px-4 py-3.5 transition hover:bg-paper-100/45 md:grid-cols-[minmax(220px,1fr)_minmax(250px,320px)]",
        field.type === "array" ? "md:items-start" : "md:items-center",
      )}
    >
      <div className="min-w-0 pr-2">
        <div className="text-[13px] font-medium text-ink-900">{label}</div>
        {field.description ? (
          <p className="mt-1 text-[12px] leading-5 text-ink-500">{field.description}</p>
        ) : null}
      </div>
      <div className="min-w-0 md:justify-self-end">
        {renderFieldInput(field, value, disabled, onChange)}
      </div>
    </div>
  );
}

function renderFieldInput(
  field: PluginConfigField,
  value: unknown,
  disabled: boolean,
  onChange: (value: unknown) => void,
): JSX.Element {
  if (field.type === "boolean") {
    return (
      <TogglePill
        enabled={Boolean(value)}
        disabled={disabled}
        label={settingLabel(field)}
        onClick={() => onChange(!Boolean(value))}
      />
    );
  }

  if (field.options && field.options.length > 0) {
    return (
      <OptionControl
        field={field}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (field.type === "number") {
    return (
      <NumberFieldControl
        field={field}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (field.type === "array") {
    return (
      <ArrayFieldControl
        field={field}
        value={Array.isArray(value) ? value : []}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (field.type === "string") {
    return field.multiline ? (
      <textarea
        value={typeof value === "string" ? value : ""}
        placeholder={field.placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={cn(inputClassName, "min-h-24 resize-y py-2")}
      />
    ) : (
      <input
        type={field.secret ? "password" : "text"}
        value={typeof value === "string" ? value : ""}
        placeholder={field.placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={inputClassName}
      />
    );
  }

  return (
    <pre className="max-h-32 overflow-auto rounded-md border border-ink-200 bg-paper-50 p-2 font-mono text-[11px] leading-5 text-ink-600">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function OptionControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PluginConfigField;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const options = field.options ?? [];
  if (options.length <= 4) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = sameOptionValue(value, option);
          return (
            <button
              key={String(option)}
              type="button"
              disabled={disabled}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition",
                active
                  ? "border-ink-800 bg-ink-900 text-paper-50"
                  : "border-ink-200 bg-paper-100 text-ink-600 hover:bg-ink-900/[0.04]",
                disabled && "pointer-events-none opacity-50",
              )}
              onClick={() => onChange(option)}
            >
              {active ? <Check className="h-3.5 w-3.5" /> : null}
              {optionLabel(field, option)}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <select
      value={String(value ?? "")}
      disabled={disabled}
      onChange={(event) => {
        const next = options.find((option) => String(option) === event.currentTarget.value);
        if (next !== undefined) onChange(next);
      }}
      className={inputClassName}
    >
      {options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {optionLabel(field, option)}
        </option>
      ))}
    </select>
  );
}

function NumberFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PluginConfigField;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const fieldKey = field.path.join("\u001f");
  const externalValue = typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const focusedRef = useRef(false);
  const fieldKeyRef = useRef(fieldKey);
  const [draftValue, setDraftValue] = useState(externalValue);

  useEffect(() => {
    if (fieldKeyRef.current !== fieldKey) {
      fieldKeyRef.current = fieldKey;
      setDraftValue(externalValue);
      return;
    }
    if (!focusedRef.current) {
      setDraftValue(externalValue);
    }
  }, [externalValue, fieldKey]);

  const commitDraft = (nextDraft: string): boolean => {
    const nextValue = readNumberDraftCommitValue(nextDraft);
    if (nextValue === null) return false;
    onChange(nextValue);
    return true;
  };

  return (
    <input
      type="number"
      value={draftValue}
      min={field.min}
      max={field.max}
      step={field.step}
      disabled={disabled}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraftValue(nextDraft);
        commitDraft(nextDraft);
      }}
      onBlur={() => {
        focusedRef.current = false;
        const blurValue = readNumberDraftBlurValue(draftValue);
        if (blurValue === null) {
          setDraftValue(externalValue);
          return;
        }
        onChange(blurValue);
        setDraftValue(String(blurValue));
      }}
      className={inputClassName}
    />
  );
}

function ArrayFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PluginConfigField;
  value: unknown[];
  disabled: boolean;
  onChange: (value: unknown[]) => void;
}): JSX.Element {
  const itemType = field.itemType ?? "string";
  const updateItem = (index: number, nextValue: unknown): void => {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? nextValue : item)));
  };

  return (
    <div className="space-y-2">
      {value.map((item, index) => (
        <div key={`${field.key}-${index}`} className="flex min-w-0 items-center gap-2">
          <input
            type={field.secret ? "password" : itemType === "number" ? "number" : "text"}
            value={String(item ?? "")}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => updateItem(index, coerceArrayItem(event.currentTarget.value, itemType))}
            className={inputClassName}
          />
          <button
            type="button"
            disabled={disabled}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-ink-200 bg-paper-50 text-ink-500 transition hover:bg-brick-50 hover:text-brick-600 disabled:pointer-events-none disabled:opacity-50"
            aria-label="删除"
            onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-ink-300 bg-paper-50 px-2.5 text-[12px] text-ink-600 transition hover:border-terra-300 hover:text-terra-700 disabled:pointer-events-none disabled:opacity-50"
        onClick={() => onChange([...value, defaultArrayItem(itemType)])}
      >
        <Plus className="h-3.5 w-3.5" />
        添加
      </button>
    </div>
  );
}

function TomlView({
  draft,
  onChange,
}: {
  draft: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="min-h-0 flex-1 bg-paper-50 px-4 py-4 sm:px-5 sm:py-6">
      <textarea
        value={draft}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "mx-auto block h-full w-full max-w-[820px] resize-none rounded-xl border border-ink-200 bg-paper-100 p-4",
          "font-mono text-[12px] leading-5 text-ink-800 shadow-panel outline-none",
          "selection:bg-terra-100 selection:text-ink-900 focus:border-terra-300 focus:ring-2 focus:ring-terra-100",
        )}
      />
    </div>
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
      aria-label={`${enabled ? "关闭" : "开启"} ${label}`}
    >
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition",
          enabled ? "bg-moss-500" : "bg-ink-300",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
            enabled && "translate-x-4",
          )}
        />
      </span>
      <span>{enabled ? "已启用" : "已关闭"}</span>
    </button>
  );
}

function Diagnostics({
  diagnostics,
  parseError,
  validationErrors,
  saveError,
}: {
  diagnostics: PluginConfigItem["diagnostics"];
  parseError?: string;
  validationErrors: string[];
  saveError?: string | null;
}): JSX.Element | null {
  const items = [
    ...diagnostics,
    ...(parseError ? [{ severity: "error" as const, message: parseError }] : []),
    ...validationErrors.map((message) => ({ severity: "error" as const, message })),
    ...(saveError ? [{ severity: "error" as const, message: saveError }] : []),
  ];
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1">
      {items.map((diagnostic, index) => (
        <div
          key={`${diagnostic.severity}-${index}`}
          className={cn(
            "rounded-md border px-2 py-1.5 text-[12px]",
            diagnostic.severity === "error"
              ? "border-brick-200 bg-brick-50 text-brick-700"
              : "border-amber-200 bg-amber-50 text-amber-800",
          )}
        >
          {diagnostic.message}
        </div>
      ))}
    </div>
  );
}

function ConfigSourceNotice({ plugin }: { plugin: PluginConfigItem }): JSX.Element | null {
  if (!plugin.needsUserConfig) {
    return null;
  }

  const templateName = plugin.configTemplatePath
    ? plugin.configTemplatePath.split(/[\\/]/).pop()
    : "PluginConfig.example.toml";

  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[12px] leading-5 text-amber-800">
      当前显示 {templateName} 模板草稿，保存后会创建实际配置文件。
    </div>
  );
}

function parseDraftToml(toml: string): {
  value?: TomlTableWithoutBigInt;
  error?: string;
} {
  try {
    return {
      value: parseToml(toml) as TomlTableWithoutBigInt,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeDraftFieldValue(
  toml: string,
  field: PluginConfigField,
  value: unknown,
): string {
  const patched = patchTomlFieldValue(toml, field, coerceFieldValue(field, value));
  if (patched) {
    return patched;
  }

  const document = parseToml(toml || "") as EditableTomlTable;
  setValueAtPath(document, field.path, coerceFieldValue(field, value));
  return ensureFinalNewline(stringifyToml(document as TomlTableWithoutBigInt));
}

function patchTomlFieldValue(
  toml: string,
  field: PluginConfigField,
  value: unknown,
): string | null {
  const [lastKey] = field.path.slice(-1);
  if (!lastKey) {
    return null;
  }

  const sectionPath = field.path.slice(0, -1);
  if (sectionPath.length === 0) {
    return null;
  }
  const lines = splitTomlLines(toml);
  const sections = findTomlSections(lines);
  const nextLine = `${lastKey} = ${serializeTomlValue(value)}`;
  const section = sections.find((item) => sameStringArray(item.path, sectionPath));

  if (!section) {
    const needsBlank = lines.length > 0 && lines[lines.length - 1]?.trim() !== "";
    return ensureFinalNewline([
      ...lines,
      ...(needsBlank ? [""] : []),
      `[${sectionPath.join(".")}]`,
      nextLine,
    ].join("\n"));
  }

  const keyLine = findTomlKeyLine(lines, section, lastKey);
  if (keyLine < 0) {
    lines.splice(section.endLine, 0, nextLine);
    return ensureFinalNewline(lines.join("\n"));
  }

  const leadingWhitespace = readLeadingWhitespace(lines[keyLine]);
  const valueEndLine = readTomlAssignmentValueEndLine(lines, section, keyLine);
  lines.splice(keyLine, valueEndLine - keyLine + 1, `${leadingWhitespace}${nextLine}`);
  return ensureFinalNewline(lines.join("\n"));
}

function setValueAtPath(
  document: EditableTomlTable,
  path: readonly string[],
  value: unknown,
): void {
  const [lastKey] = path.slice(-1);
  if (!lastKey) {
    return;
  }

  let current: EditableTomlTable = document;
  for (const part of path.slice(0, -1)) {
    const next = current[part];
    if (!isRecord(next)) {
      current[part] = {};
    }
    current = current[part] as EditableTomlTable;
  }
  current[lastKey] = value;
}

function serializeTomlValue(value: unknown): string {
  const serialized = stringifyToml({ value } as TomlTableWithoutBigInt).trim();
  const prefix = "value = ";
  return serialized.startsWith(prefix) ? serialized.slice(prefix.length) : JSON.stringify(value);
}

function splitTomlLines(toml: string): string[] {
  const normalized = toml.split("\r\n").join("\n").split("\r").join("\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return body.length > 0 ? body.split("\n") : [];
}

function findTomlSections(lines: readonly string[]): TomlSectionRange[] {
  const sections: TomlSectionRange[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const sectionPath = readTomlSectionPath(lines[index]);
    if (!sectionPath) {
      continue;
    }

    const previous = sections[sections.length - 1];
    if (previous) {
      previous.endLine = index;
    }

    sections.push({
      path: sectionPath,
      startLine: index,
      endLine: lines.length,
    });
  }
  return sections;
}

function readTomlSectionPath(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]") || trimmed.startsWith("[[")) {
    return undefined;
  }

  const body = trimmed.slice(1, -1).trim();
  const parts = body.split(".").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function findTomlKeyLine(
  lines: readonly string[],
  section: TomlSectionRange,
  key: string,
): number {
  for (let index = section.startLine + 1; index < section.endLine; index += 1) {
    if (tomlLineDefinesKey(lines[index], key)) {
      return index;
    }
  }
  return -1;
}

function tomlLineDefinesKey(line: string, key: string): boolean {
  const trimmed = line.trimStart();
  if (!trimmed || trimmed.startsWith("#")) {
    return false;
  }

  if (!trimmed.startsWith(key)) {
    return false;
  }

  let index = key.length;
  while (trimmed[index] === " " || trimmed[index] === "\t") {
    index += 1;
  }
  return trimmed[index] === "=";
}

function readTomlAssignmentValueEndLine(
  lines: readonly string[],
  section: TomlSectionRange,
  keyLine: number,
): number {
  if (!lines[keyLine]?.includes("[")) {
    return keyLine;
  }

  let balance = 0;
  for (let index = keyLine; index < section.endLine; index += 1) {
    balance += countTomlArrayBalance(lines[index]);
    if (balance <= 0) {
      return index;
    }
  }
  return keyLine;
}

function countTomlArrayBalance(line: string): number {
  let balance = 0;
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of line) {
    if (quote) {
      if (quote === '"' && char === "\\" && !escaping) {
        escaping = true;
        continue;
      }
      if (char === quote && !escaping) {
        quote = null;
      }
      escaping = false;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[") {
      balance += 1;
    }
    if (char === "]") {
      balance -= 1;
    }
  }
  return balance;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readLeadingWhitespace(value: string): string {
  let index = 0;
  while (value[index] === " " || value[index] === "\t") {
    index += 1;
  }
  return value.slice(0, index);
}

interface TomlSectionRange {
  path: string[];
  startLine: number;
  endLine: number;
}

function readDraftValue(
  parsedDraft: TomlTableWithoutBigInt | undefined,
  field: PluginConfigField,
): unknown {
  let current: unknown = parsedDraft;
  for (const part of field.path) {
    current = isRecord(current) ? current[part] : undefined;
  }
  return current === undefined ? field.value : current;
}

export function validatePluginConfigDraft(
  sections: readonly PluginConfigSection[],
  parsedDraft: TomlTableWithoutBigInt,
): string[] {
  const errors: string[] = [];
  for (const section of sections) {
    for (const field of section.fields) {
      errors.push(...validatePluginConfigField(field, readDraftValue(parsedDraft, field)));
    }
  }
  return errors;
}

function validatePluginConfigField(field: PluginConfigField, value: unknown): string[] {
  const errors: string[] = [];
  const label = settingLabel(field);

  if (field.type === "boolean" && typeof value !== "boolean") {
    errors.push(`${label} 必须是布尔值`);
  }

  if (field.type === "string" && typeof value !== "string") {
    errors.push(`${label} 必须是字符串`);
  }

  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${label} 必须是数字`);
    } else {
      errors.push(...validateNumberField(field, value, label));
    }
  }

  if (field.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${label} 必须是数组`);
    } else {
      value.forEach((item, index) => {
        errors.push(...validateArrayItem(field, item, index, label));
      });
    }
  }

  if (field.options && field.options.length > 0) {
    const values = field.type === "array" && Array.isArray(value) ? value : [value];
    values.forEach((item, index) => {
      if (!field.options?.some((option) => sameOptionValue(item, option))) {
        const suffix = values.length > 1 ? ` 第 ${index + 1} 项` : "";
        errors.push(`${label}${suffix} 必须是允许的选项`);
      }
    });
  }

  return errors;
}

function validateNumberField(
  field: PluginConfigField,
  value: number,
  label: string,
): string[] {
  const errors: string[] = [];
  if (typeof field.min === "number" && value < field.min) {
    errors.push(`${label} 不能小于 ${field.min}`);
  }
  if (typeof field.max === "number" && value > field.max) {
    errors.push(`${label} 不能大于 ${field.max}`);
  }
  if (typeof field.step === "number" && field.step > 0) {
    const base = typeof field.min === "number" ? field.min : 0;
    const quotient = (value - base) / field.step;
    if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
      errors.push(`${label} 必须按 ${field.step} 递增`);
    }
  }
  return errors;
}

function validateArrayItem(
  field: PluginConfigField,
  value: unknown,
  index: number,
  label: string,
): string[] {
  const itemLabel = `${label} 第 ${index + 1} 项`;
  if (field.itemType === "boolean" && typeof value !== "boolean") {
    return [`${itemLabel} 必须是布尔值`];
  }
  if (field.itemType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return [`${itemLabel} 必须是数字`];
    }
    return validateNumberField(field, value, itemLabel);
  }
  if ((field.itemType === "string" || !field.itemType) && typeof value !== "string") {
    return [`${itemLabel} 必须是字符串`];
  }
  return [];
}

function coerceFieldValue(field: PluginConfigField, value: unknown): unknown {
  if (field.type === "boolean") {
    return Boolean(value);
  }
  if (field.type === "number") {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  if (field.type === "array") {
    return Array.isArray(value)
      ? value.map((item) => coerceArrayItem(item, field.itemType ?? "string"))
      : [];
  }
  if (field.type === "string") {
    return String(value ?? "");
  }
  return value;
}

function coerceArrayItem(value: unknown, itemType: string): unknown {
  if (itemType === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (itemType === "boolean") {
    return Boolean(value);
  }
  return String(value ?? "");
}

export function readNumberDraftCommitValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || isIncompleteNumberDraft(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function readNumberDraftBlurValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "+") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isIncompleteNumberDraft(value: string): boolean {
  return value === "-"
    || value === "+"
    || value.endsWith(".")
    || /[eE][+-]?$/.test(value);
}

function defaultArrayItem(itemType: string): unknown {
  if (itemType === "number") {
    return 0;
  }
  if (itemType === "boolean") {
    return false;
  }
  return "";
}

function optionLabel(
  field: PluginConfigField,
  option: PluginConfigFieldOptionValue,
): string {
  return field.optionLabels?.[String(option)] ?? String(option);
}

function sameOptionValue(left: unknown, right: PluginConfigFieldOptionValue): boolean {
  return String(left) === String(right);
}

function settingLabel(field: PluginConfigField): string {
  return field.label ?? "未命名参数";
}

function confirmDiscardDirtyDraft(): boolean {
  return window.confirm("当前技能配置有未保存修改，切换后会丢失这些修改。确定切换吗？");
}

function pluginSearchText(plugin: PluginConfigItem): string {
  const fieldText = plugin.sections
    .flatMap((section) => [
      section.name,
      section.label ?? "",
      section.description ?? "",
      ...section.fields.flatMap((field) => [
        field.key,
        field.label ?? "",
        field.description ?? "",
      ]),
    ])
    .join(" ");
  const toolText = plugin.tools
    .flatMap((tool) => [tool.name, tool.summary ?? ""])
    .join(" ");

  return [
    plugin.name,
    pluginDisplayTitle(plugin),
    plugin.description ?? "",
    toolText,
    fieldText,
  ].join(" ").toLocaleLowerCase();
}

function pluginDisplayTitle(plugin: PluginConfigItem): string {
  const title = plugin.title.trim();
  const name = plugin.name.trim();
  return title && title !== plugin.name ? title : name || "未命名技能";
}

function ensureFinalNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function isRecord(value: unknown): value is EditableTomlTable {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const inputClassName = cn(
  "h-8 w-full rounded-lg border border-ink-200 bg-paper-100 px-2.5 text-[12.5px] text-ink-800",
  "outline-none transition placeholder:text-ink-400",
  "focus:border-terra-300 focus:ring-2 focus:ring-terra-100",
  "disabled:pointer-events-none disabled:opacity-55",
);
