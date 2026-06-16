import { useEffect, useMemo, useState } from "react";
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
import { ScrollArea } from "../ui/ScrollArea";
import { Tooltip } from "../ui/Tooltip";
import { Button } from "../ui-shadcn/button";
import { Sheet, SheetContent } from "../ui-shadcn/sheet";

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
  const filteredPlugins = useMemo(() => {
    const query = filterText.trim().toLocaleLowerCase();
    if (!query) {
      return configurablePlugins;
    }
    return configurablePlugins.filter((plugin) => {
      const text = [
        pluginDisplayTitle(plugin),
        plugin.description ?? "",
      ].join(" ").toLocaleLowerCase();
      return text.includes(query);
    });
  }, [configurablePlugins, filterText]);
  const parsedDraft = useMemo(() => parseDraftToml(draft), [draft]);
  const visibleSections = selected?.sections.filter((section) => section.fields.length > 0) ?? [];
  const saveOperation = saveRequestId ? operations[saveRequestId] : undefined;
  const toggleOperation = toggleRequestId ? operations[toggleRequestId] : undefined;
  const saving = saveOperation?.status === "pending";
  const toggling = toggleOperation?.status === "pending";

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
    if (!selected || !dirty || parsedDraft.error || saving) return;
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

  return (
    <Sheet open={open} onOpenChange={setOpen}>
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
          {hasErrors ? <AlertTriangle className="h-3.5 w-3.5 text-brick-500" /> : null}
        </button>
      </Tooltip>

      <SheetContent
        side="right"
        title="技能配置"
        description="外部技能参数"
        className="w-[min(1120px,calc(100vw-18px))] bg-paper-100 p-0"
      >
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-paper-100 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="min-h-0 border-b border-ink-200/70 bg-paper-200/45 lg:border-b-0 lg:border-r">
            <div className="flex h-14 items-center justify-between gap-2 px-4">
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-ink-900">外部技能</div>
                <div className="mt-0.5 text-[11px] text-ink-500">
                  {activePlugins}/{configurablePlugins.length || 0} 已启用
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

            <div className="px-3 pb-2">
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

            <ScrollArea className="h-[260px] lg:h-[calc(100vh-152px)]">
              <div className="space-y-1 px-2 pb-3 pt-1">
                {filteredPlugins.map((plugin) => {
                  const active = selected?.name === plugin.name;
                  const error = plugin.diagnostics.some((diagnostic) => diagnostic.severity === "error");
                  return (
                    <button
                      key={plugin.name}
                      type="button"
                      className={cn(
                        "flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition",
                        active
                          ? "bg-paper-50 text-ink-900 shadow-panel"
                          : "text-ink-600 hover:bg-paper-50/70 hover:text-ink-900",
                      )}
                      onClick={() => setSelectedName(plugin.name)}
                    >
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          error
                            ? "bg-brick-500"
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
                  <div className="px-3 py-8 text-center text-[12px] text-ink-400">
                    没有匹配的技能
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden bg-paper-50">
            {selected ? (
              <>
                <div className="border-b border-ink-200/70 bg-paper-50/95 px-5 py-4">
                  <div className="mx-auto flex max-w-[760px] min-w-0 flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[18px] font-semibold text-ink-900">
                        {pluginDisplayTitle(selected)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-500">
                        <span>{selected.enabledToolCount}/{selected.toolCount} 个技能启用</span>
                        {saving ? (
                          <>
                            <span className="text-ink-300">/</span>
                            <span className="text-terra-700">正在保存</span>
                          </>
                        ) : dirty ? (
                          <>
                            <span className="text-ink-300">/</span>
                            <span className="text-terra-700">有未保存修改</span>
                          </>
                        ) : null}
                      </div>
                    </div>

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
                      disabled={!dirty || saving || Boolean(parsedDraft.error)}
                      onClick={save}
                      className="h-8"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {saving ? "正在保存" : "保存"}
                    </Button>
                  </div>

                  <Diagnostics
                    diagnostics={selected.diagnostics}
                    parseError={parsedDraft.error}
                    saveError={saveError}
                  />
                </div>

                {view === "settings" ? (
                  <SettingsView
                    sections={visibleSections}
                    parsedDraft={parsedDraft.value}
                    parseError={parsedDraft.error}
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
      </SheetContent>
    </Sheet>
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
  sections,
  parsedDraft,
  parseError,
  onUpdateField,
}: {
  sections: PluginConfigSection[];
  parsedDraft?: TomlTableWithoutBigInt;
  parseError?: string;
  onUpdateField: (field: PluginConfigField, value: unknown) => void;
}): JSX.Element {
  return (
    <ScrollArea className="min-h-0 flex-1 bg-paper-50">
      <div className="mx-auto min-h-full w-full max-w-[760px] px-5 py-8">
        {parseError ? (
          <div className="mb-5 rounded-xl border border-brick-100 bg-brick-50 px-3 py-2 text-[12.5px] text-brick-700">
            配置源码解析失败，修复后才能使用设置视图。
          </div>
        ) : null}

        {sections.length > 0 ? (
          <div className={cn("space-y-7", parseError && "opacity-60")}>
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
          <div className="grid min-h-64 place-items-center rounded-xl border border-ink-200/70 bg-paper-50 text-[13px] text-ink-400 shadow-panel">
            该技能没有可视化配置项
          </div>
        )}
      </div>
    </ScrollArea>
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
      <input
        type="number"
        value={typeof value === "number" && Number.isFinite(value) ? value : ""}
        min={field.min}
        max={field.max}
        step={field.step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className={inputClassName}
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
    <div className="min-h-0 flex-1 bg-paper-50 px-5 py-6">
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
  saveError,
}: {
  diagnostics: PluginConfigItem["diagnostics"];
  parseError?: string;
  saveError?: string | null;
}): JSX.Element | null {
  const items = [
    ...diagnostics,
    ...(parseError ? [{ severity: "error" as const, message: parseError }] : []),
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

function writeDraftFieldValue(
  toml: string,
  field: PluginConfigField,
  value: unknown,
): string {
  const document = parseToml(toml || "") as EditableTomlTable;
  setValueAtPath(document, field.path, coerceFieldValue(field, value));
  return ensureFinalNewline(stringifyToml(document as TomlTableWithoutBigInt));
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

function pluginDisplayTitle(plugin: PluginConfigItem): string {
  const title = plugin.title.trim();
  return title && title !== plugin.name ? title : "未命名技能";
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
