import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Component, lazy, Suspense, useMemo, type ReactNode } from "react";
import { cva } from "class-variance-authority";
import { BadgeCheck, Check, CircleOff, Loader2, Power, PowerOff, Save, ScrollText, Trash2 } from "lucide-react";
import type { PresetFormat, PresetItem } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { Button, ScrollArea } from "../../shared/ui";
import {
  PresetEditorLanguages,
  PresetFormatOptions,
  formatInteger,
  formatPresetTime,
  formatTokenState,
  readEditorStats,
  readPresetDisplayName,
  readPresetStatusLabel,
  validateDraft,
  withPresetFormatExtension,
  type PresetEditorStats,
  type PresetTokenState,
} from "./presetPanelUtils";

const LazyCodeTextEditor = lazy(async () => {
  const module = await import("../../shared/code/CodeTextEditor");
  return { default: module.CodeTextEditor };
});

type PresetEditorFailureBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type PresetEditorFailureBoundaryState = {
  error: Error | null;
};

export class PresetEditorFailureBoundary extends Component<
  PresetEditorFailureBoundaryProps,
  PresetEditorFailureBoundaryState
> {
  state: PresetEditorFailureBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): PresetEditorFailureBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

export function PresetTextEditorFallback({
  content,
  disabled,
  onChange,
}: {
  content: string;
  disabled: boolean;
  onChange: (content: string) => void;
}): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-paper-50">
      <div role="alert" className="shrink-0 border-b border-ink-200 bg-paper-100 px-3 py-2 text-[12px] text-ink-700">
        {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.90.9")}
      </div>
      <textarea
        aria-label={frontendMessage("preset.ui.content")}
        className="min-h-0 flex-1 resize-none bg-paper-50 px-4 py-3 font-mono text-[13px] leading-6 text-ink-800 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-inset focus:ring-accent-focus disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        spellCheck={false}
        value={content}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

const statusPillClass = cva(
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] shadow-sm",
  {
    variants: {
      state: {
        active: "border-accent-border bg-accent-surface text-accent-content",
        busy: "border-ink-200 bg-paper-50 text-ink-500",
        dirty: "border-ink-200 bg-paper-100 text-umber-600",
        idle: "border-ink-200 bg-paper-50 text-ink-500",
      },
    },
  },
);

export function PresetWorkspace({
  busy,
  deleting,
  diagnostics,
  dirty,
  draftContent,
  draftFormat,
  draftName,
  importing,
  saving,
  selected,
  selectedIsActive,
  settingActive,
  tokenState,
  onContentChange,
  onDelete,
  onFormatChange,
  onNameChange,
  onSave,
  onToggleActive,
}: {
  busy: boolean;
  deleting: boolean;
  diagnostics: Array<{ severity: "error" | "warning"; message: string }>;
  dirty: boolean;
  draftContent: string;
  draftFormat: PresetFormat;
  draftName: string;
  importing: boolean;
  saving: boolean;
  selected: PresetItem | null;
  selectedIsActive: boolean;
  settingActive: boolean;
  tokenState: PresetTokenState;
  onContentChange: (content: string) => void;
  onDelete: () => void;
  onFormatChange: (format: PresetFormat) => void;
  onNameChange: (name: string) => void;
  onSave: (activate: boolean) => void;
  onToggleActive: () => void;
}): JSX.Element {
  return (
    <section className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--theme-config-panel-bg)]">
      <PresetToolbar
        busy={busy}
        deleting={deleting}
        dirty={dirty}
        draftFormat={draftFormat}
        draftName={draftName}
        importing={importing}
        saving={saving}
        selected={selected}
        selectedIsActive={selectedIsActive}
        settingActive={settingActive}
        onDelete={onDelete}
        onFormatChange={onFormatChange}
        onNameChange={onNameChange}
        onSave={onSave}
        onToggleActive={onToggleActive}
      />

      <Diagnostics items={diagnostics} />

      <div className="min-h-0 flex-1 bg-[var(--theme-config-panel-bg)] p-3 sm:p-4">
        <PresetEditor
          content={draftContent}
          format={draftFormat}
          disabled={busy}
          tokenState={tokenState}
          onChange={onContentChange}
        />
      </div>
    </section>
  );
}

export function PresetInspector({
  active,
  content,
  dirty,
  format,
  name,
  preset,
  tokenState,
}: {
  active: boolean;
  content: string;
  dirty: boolean;
  format: PresetFormat;
  name: string;
  preset: PresetItem | null;
  tokenState: PresetTokenState;
}): JSX.Element {
  const stats = useMemo(() => readEditorStats(content), [content]);
  const jsonIssue = useMemo(
    () => (format === "json" && content.trim() ? validateDraft(format, content) : null),
    [content, format],
  );
  const formatLabel = PresetFormatOptions.find((option) => option.value === format)?.label ?? format;
  const displayName = readPresetDisplayName(name || preset?.name || "");
  const statusLabel = readPresetStatusLabel({ active, dirty, jsonIssue });

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-ink-200/70 bg-[var(--theme-config-nav-bg)]">
      <div className="shrink-0 border-b border-ink-200/70 px-3.5 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-ink-900">
              {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.225.69")}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-ink-500">{displayName || "未命名预设"}</div>
          </div>
          <span
            className={cn(
              "shrink-0 border px-1.5 py-0.5 text-[10.5px]",
              jsonIssue
                ? "border-brick-200 bg-brick-50 text-brick-700"
                : dirty
                  ? "border-ink-200 bg-paper-100 text-umber-600"
                  : active
                    ? "border-accent-border bg-accent-surface text-accent-content"
                    : "border-ink-200 bg-paper-50 text-ink-500",
            )}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <PresetMetricGrid
        formatLabel={formatLabel}
        stats={stats}
        tokenState={tokenState}
        updatedAt={preset?.updatedAt ?? null}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y divide-ink-200/70">
          <PresetInfoSection
            displayName={displayName}
            formatLabel={formatLabel}
            statusLabel={statusLabel}
            updatedAt={preset?.updatedAt ?? null}
          />

          {jsonIssue ? (
            <section className="px-3.5 py-3">
              <div className="text-[11px] font-medium text-brick-600">
                {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.263.97")}
              </div>
              <div className="mt-2 whitespace-pre-wrap border-l-2 border-brick-300 bg-brick-50/70 px-2.5 py-2 text-[11.5px] leading-5 text-brick-700">
                {jsonIssue}
              </div>
            </section>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}

function PresetToolbar({
  busy,
  deleting,
  dirty,
  draftFormat,
  draftName,
  importing,
  saving,
  selected,
  selectedIsActive,
  settingActive,
  onDelete,
  onFormatChange,
  onNameChange,
  onSave,
  onToggleActive,
}: {
  busy: boolean;
  deleting: boolean;
  dirty: boolean;
  draftFormat: PresetFormat;
  draftName: string;
  importing: boolean;
  saving: boolean;
  selected: PresetItem | null;
  selectedIsActive: boolean;
  settingActive: boolean;
  onDelete: () => void;
  onFormatChange: (format: PresetFormat) => void;
  onNameChange: (name: string) => void;
  onSave: (activate: boolean) => void;
  onToggleActive: () => void;
}): JSX.Element {
  const displayDraftName = readPresetDisplayName(draftName);
  return (
    <div className="shrink-0 border-b border-ink-200/70 bg-[var(--theme-config-panel-bg)] px-3.5 py-3.5 sm:px-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-center">
          <StatusPill active={selectedIsActive} dirty={dirty} busy={busy} />
          <input
            value={displayDraftName}
            onChange={(event) => onNameChange(withPresetFormatExtension(event.currentTarget.value, draftFormat))}
            placeholder="preset"
            spellCheck={false}
            aria-label={frontendMessage("preset.ui.name")}
            className="h-9 min-w-0 flex-1 rounded-lg border border-ink-200 bg-paper-50 px-3 font-mono text-[12.5px] text-ink-800 shadow-sm outline-none transition placeholder:text-ink-400 focus:border-accent-border focus:ring-2 focus:ring-accent-focus"
          />
          <FormatSwitch value={draftFormat} onChange={onFormatChange} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={selectedIsActive ? "outline" : "ghost"}
            disabled={!selected || settingActive}
            onClick={onToggleActive}
            className="h-9 bg-paper-50"
          >
            {settingActive ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : selectedIsActive ? (
              <PowerOff className="h-3.5 w-3.5" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
            {selectedIsActive ? "关闭" : "启用"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!selected || deleting}
            onClick={onDelete}
            className="h-9 text-brick-600 hover:bg-brick-50 hover:text-brick-700"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.350.13")}
          </Button>
          <span className="mx-0.5 hidden h-6 w-px bg-ink-200/80 sm:block" />
          <Button
            size="sm"
            variant="outline"
            disabled={saving || importing}
            onClick={() => onSave(false)}
            className="h-9 bg-paper-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.361.13")}
          </Button>
          <Button size="sm" disabled={saving || importing} onClick={() => onSave(true)} className="h-9">
            <Check className="h-3.5 w-3.5" />
            {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.370.13")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PresetEditor({
  content,
  disabled,
  format,
  tokenState,
  onChange,
}: {
  content: string;
  disabled: boolean;
  format: PresetFormat;
  tokenState: PresetTokenState;
  onChange: (content: string) => void;
}): JSX.Element {
  const stats = useMemo(() => readEditorStats(content), [content]);
  const formatLabel = PresetFormatOptions.find((option) => option.value === format)?.label ?? format;
  const language = PresetEditorLanguages[format];
  const jsonIssue = useMemo(
    () => (format === "json" && content.trim() ? validateDraft(format, content) : null),
    [content, format],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border border-ink-200/80 bg-paper-50 shadow-panel">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-ink-200/70 bg-[var(--theme-config-toolbar-bg)] px-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 place-items-center border border-ink-200/70 bg-paper-50 text-ink-500">
            <ScrollText className="h-3.5 w-3.5" />
          </span>
          <span className="text-[11px] font-medium text-ink-600">{formatLabel}</span>
          {jsonIssue ? (
            <span className="truncate rounded-md bg-brick-50 px-1.5 py-0.5 text-[11px] text-brick-700">
              {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.409.15")}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10.5px] tabular-nums text-ink-400">
          <span>{formatTokenState(tokenState)}</span>
          <span>
            {formatInteger(stats.lines)} {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.415.46")}
          </span>
          <span>
            {formatInteger(stats.characters)} {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.416.51")}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <PresetEditorFailureBoundary
          fallback={<PresetTextEditorFallback content={content} disabled={disabled} onChange={onChange} />}
        >
          <Suspense fallback={<EditorLoading />}>
            <LazyCodeTextEditor
              ariaLabel="角色预设内容"
              className={cn("min-h-0 flex-1", jsonIssue && "[&_.cm-editor]:bg-brick-50/20")}
              disabled={disabled}
              language={language}
              onChange={onChange}
              value={content}
            />
          </Suspense>
        </PresetEditorFailureBoundary>
      </div>
    </div>
  );
}

function PresetMetricGrid({
  formatLabel,
  stats,
  tokenState,
  updatedAt,
}: {
  formatLabel: string;
  stats: PresetEditorStats;
  tokenState: PresetTokenState;
  updatedAt: string | null;
}): JSX.Element {
  return (
    <div className="shrink-0 border-b border-ink-200/70">
      <div className="grid grid-cols-2">
        <MetricCell label="Token" value={formatTokenState(tokenState)} />
        <MetricCell
          label={frontendMessage("runtime.migrated.features.chat.PresetWorkspace.463.27")}
          value={formatInteger(stats.characters)}
        />
        <MetricCell
          label={frontendMessage("runtime.migrated.features.chat.PresetWorkspace.464.27")}
          value={formatInteger(stats.lines)}
        />
        <MetricCell
          label={frontendMessage("runtime.migrated.features.chat.PresetWorkspace.465.27")}
          value={formatInteger(stats.bytes)}
        />
      </div>
      <div className="grid grid-cols-[72px_minmax(0,1fr)] border-t border-ink-200/70 px-3.5 py-2 text-[11.5px] leading-5">
        <span className="text-ink-400">{frontendMessage("runtime.migrated.features.chat.PresetWorkspace.468.40")}</span>
        <span className="min-w-0 truncate text-ink-700">{formatLabel}</span>
        {updatedAt ? (
          <>
            <span className="text-ink-400">
              {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.472.44")}
            </span>
            <span className="min-w-0 truncate text-ink-700">{formatPresetTime(updatedAt)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="border-r border-t border-ink-200/70 px-3.5 py-2 first:border-t-0 [&:nth-child(2)]:border-r-0 [&:nth-child(2)]:border-t-0 [&:nth-child(4)]:border-r-0">
      <div className="text-[10.5px] text-ink-400">{label}</div>
      <div className="mt-0.5 truncate text-[12.5px] tabular-nums text-ink-800">{value}</div>
    </div>
  );
}

function PresetInfoSection({
  displayName,
  formatLabel,
  statusLabel,
  updatedAt,
}: {
  displayName: string;
  formatLabel: string;
  statusLabel: string;
  updatedAt: string | null;
}): JSX.Element {
  return (
    <section className="px-3.5 py-3">
      <div className="text-[11px] font-medium text-ink-500">
        {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.509.87")}
      </div>
      <dl className="mt-2 divide-y divide-ink-200/70 border-y border-ink-200/70">
        <InfoRow
          label={frontendMessage("runtime.migrated.features.chat.PresetWorkspace.511.24")}
          value={displayName || "未命名预设"}
        />
        <InfoRow label={frontendMessage("runtime.migrated.features.chat.PresetWorkspace.512.24")} value={formatLabel} />
        <InfoRow label={frontendMessage("runtime.migrated.features.chat.PresetWorkspace.513.24")} value={statusLabel} />
        {updatedAt ? (
          <InfoRow
            label={frontendMessage("runtime.migrated.features.chat.PresetWorkspace.514.37")}
            value={formatPresetTime(updatedAt)}
          />
        ) : null}
      </dl>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 py-1.5 text-[11.5px] leading-5">
      <dt className="text-ink-400">{label}</dt>
      <dd className="min-w-0 truncate text-ink-700">{value}</dd>
    </div>
  );
}

function EditorLoading(): JSX.Element {
  return (
    <div className="grid h-full min-h-0 place-items-center bg-[var(--theme-config-editor-loading-bg)] text-[12px] text-ink-400">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {frontendMessage("runtime.migrated.features.chat.PresetWorkspace.540.9")}
      </span>
    </div>
  );
}

function StatusPill({ active, dirty, busy }: { active: boolean; dirty: boolean; busy: boolean }): JSX.Element {
  const label = busy ? "处理中" : dirty ? "未保存" : active ? "已启用" : "未启用";
  const state = busy ? "busy" : dirty ? "dirty" : active ? "active" : "idle";
  return (
    <span className={statusPillClass({ state })}>
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : active ? (
        <BadgeCheck className="h-3.5 w-3.5" />
      ) : (
        <CircleOff className="h-3.5 w-3.5" />
      )}
      {label}
    </span>
  );
}

function FormatSwitch({
  value,
  onChange,
}: {
  value: PresetFormat;
  onChange: (value: PresetFormat) => void;
}): JSX.Element {
  return (
    <div className="grid h-9 shrink-0 grid-cols-3 rounded-lg border border-ink-200 bg-paper-50 p-1 shadow-sm">
      {PresetFormatOptions.map((item) => (
        <button
          key={item.value}
          type="button"
          className={cn(
            "inline-flex min-w-12 items-center justify-center rounded-md px-2 text-[11px] font-medium transition",
            value === item.value ? "bg-paper-50 text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800",
          )}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Diagnostics({
  items,
}: {
  items: Array<{ severity: "error" | "warning"; message: string }>;
}): JSX.Element | null {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="shrink-0 space-y-1 border-b border-ink-200/60 bg-paper-50 px-3 py-2 sm:px-5">
      {items.map((item, index) => (
        <div
          key={`${item.severity}-${index}`}
          className={cn(
            "whitespace-pre-wrap rounded-md border px-2 py-1.5 text-[12px]",
            item.severity === "error"
              ? "border-brick-200 bg-brick-50 text-brick-700"
              : "border-ink-200 bg-paper-100 text-umber-600",
          )}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
