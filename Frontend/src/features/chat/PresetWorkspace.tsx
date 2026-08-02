import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Component, lazy, Suspense, useMemo, type ReactNode } from "react";
import { cva } from "class-variance-authority";
import { BadgeCheck, Check, CircleOff, Power, PowerOff, Save, ScrollText, Trash2 } from "lucide-react";
import type { PresetFormat, PresetItem } from "../../api/eventTypes";
import { cn, formatInteger, formatShortTime } from "../../lib/util";
import { Button, IconButton, Spinner, StateView } from "../../shared/ui";
import { ConfigDiagnosticsList } from "./ConfigDiagnostics";
import {
  PresetEditorLanguages,
  PresetFormatOptions,
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
        {frontendMessage("preset.ui.editorFallbackNotice")}
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

const statusPillClass = cva("inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px]", {
  variants: {
    state: {
      active: "border-accent-border bg-accent-surface text-accent-content",
      busy: "border-ink-200 bg-paper-50 text-ink-500",
      dirty: "border-ink-200 bg-paper-100 text-umber-600",
      idle: "border-ink-200 bg-paper-50 text-ink-500",
    },
  },
});

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
  const stats = useMemo(() => readEditorStats(draftContent), [draftContent]);
  const jsonIssue = useMemo(
    () => (draftFormat === "json" && draftContent.trim() ? validateDraft(draftFormat, draftContent) : null),
    [draftContent, draftFormat],
  );

  return (
    <section className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden bg-surface-panel">
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

      <div className="min-h-0 flex-1 bg-surface-subtle p-3 sm:p-4">
        <PresetEditor
          content={draftContent}
          format={draftFormat}
          disabled={busy}
          tokenState={tokenState}
          onChange={onContentChange}
        />
      </div>

      <PresetStatusBar
        active={selectedIsActive}
        busy={busy}
        dirty={dirty}
        format={draftFormat}
        jsonIssue={jsonIssue}
        stats={stats}
        tokenState={tokenState}
        updatedAt={selected?.updatedAt ?? null}
      />
    </section>
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
    <div className="shrink-0 border-b border-line-subtle bg-surface-panel px-3.5 py-3 sm:px-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <StatusPill active={selectedIsActive} dirty={dirty} busy={busy} />
          <input
            value={displayDraftName}
            onChange={(event) => onNameChange(withPresetFormatExtension(event.currentTarget.value, draftFormat))}
            placeholder="preset"
            spellCheck={false}
            aria-label={frontendMessage("preset.ui.name")}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface-panel px-3 font-mono text-[12.5px] text-content-primary shadow-sm outline-none transition placeholder:text-content-muted focus:border-accent-border focus:ring-2 focus:ring-accent-focus"
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <FormatSwitch value={draftFormat} onChange={onFormatChange} />
          <span className="mx-0.5 hidden h-5 w-px bg-line-subtle sm:block" />
          <IconButton
            label={frontendMessage("preset.ui.delete")}
            tooltip={frontendMessage("preset.ui.delete")}
            size="md"
            tone="danger"
            disabled={!selected || deleting}
            onClick={onDelete}
            className="bg-surface-panel"
          >
            {deleting ? <Spinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
          </IconButton>
          <Button
            size="sm"
            variant={selectedIsActive ? "outline" : "ghost"}
            disabled={!selected || settingActive}
            onClick={onToggleActive}
            className="h-9 bg-surface-panel"
          >
            {settingActive ? (
              <Spinner size="sm" />
            ) : selectedIsActive ? (
              <PowerOff className="h-3.5 w-3.5" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
            {frontendMessage(selectedIsActive ? "preset.ui.disable" : "preset.ui.enable")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={saving || importing}
            onClick={() => onSave(false)}
            className="h-9 bg-surface-panel"
          >
            {saving ? <Spinner size="sm" /> : <Save className="h-3.5 w-3.5" />}
            {frontendMessage("preset.ui.save")}
          </Button>
          <Button size="sm" disabled={saving || importing} onClick={() => onSave(true)} className="h-9">
            <Check className="h-3.5 w-3.5" />
            {frontendMessage("preset.ui.saveAndEnable")}
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden border border-line-subtle bg-paper-50 shadow-panel">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line-subtle bg-surface-subtle px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded border border-line-subtle bg-surface-panel text-content-muted">
            <ScrollText className="h-3.5 w-3.5" />
          </span>
          <span className="text-[11px] font-medium text-content-secondary">{formatLabel}</span>
          {jsonIssue ? (
            <span className="truncate rounded-md bg-brick-50 px-1.5 py-0.5 text-[11px] text-brick-700">
              {frontendMessage("preset.ui.jsonFailed")}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10.5px] tabular-nums text-content-muted">
          <span>{formatTokenState(tokenState)}</span>
          <span>{frontendMessage("preset.ui.lineCount", { count: formatInteger(stats.lines) })}</span>
          <span>{frontendMessage("preset.ui.characterCount", { count: formatInteger(stats.characters) })}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <PresetEditorFailureBoundary
          fallback={<PresetTextEditorFallback content={content} disabled={disabled} onChange={onChange} />}
        >
          <Suspense fallback={<EditorLoading />}>
            <LazyCodeTextEditor
              ariaLabel={frontendMessage("preset.ui.content")}
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

function PresetStatusBar({
  active,
  busy,
  dirty,
  format,
  jsonIssue,
  stats,
  tokenState,
  updatedAt,
}: {
  active: boolean;
  busy: boolean;
  dirty: boolean;
  format: PresetFormat;
  jsonIssue: string | null;
  stats: PresetEditorStats;
  tokenState: PresetTokenState;
  updatedAt: string | null;
}): JSX.Element {
  const formatLabel = PresetFormatOptions.find((option) => option.value === format)?.label ?? format;
  const statusLabel = readPresetStatusLabel({ active, dirty, jsonIssue });

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line-subtle bg-surface-subtle px-3.5 py-2 text-[11px] text-content-secondary sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <StatusPill active={active} dirty={dirty} busy={busy} />
        <span className="truncate text-content-muted">{formatLabel}</span>
        {updatedAt ? (
          <span className="hidden truncate text-content-muted sm:inline">{formatShortTime(updatedAt)}</span>
        ) : null}
        <span className="truncate text-content-muted">· {statusLabel}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2 tabular-nums">
        <span>{formatTokenState(tokenState)}</span>
        <span className="hidden sm:inline">·</span>
        <span className="hidden sm:inline">
          {frontendMessage("preset.ui.characterCount", { count: formatInteger(stats.characters) })}
        </span>
        <span className="hidden sm:inline">·</span>
        <span className="hidden sm:inline">
          {frontendMessage("preset.ui.lineCount", { count: formatInteger(stats.lines) })}
        </span>
        <span>·</span>
        <span>{frontendMessage("preset.ui.bytes", { count: formatInteger(stats.bytes) })}</span>
      </div>
    </div>
  );
}

function EditorLoading(): JSX.Element {
  return (
    <StateView
      status="loading"
      className="h-full bg-[var(--theme-config-editor-loading-bg)]"
      description={frontendMessage("preset.ui.loadingEditor")}
    />
  );
}

function StatusPill({ active, dirty, busy }: { active: boolean; dirty: boolean; busy: boolean }): JSX.Element {
  const label = frontendMessage(
    busy ? "preset.ui.processing" : dirty ? "preset.ui.unsaved" : active ? "preset.ui.enabled" : "preset.ui.disabled",
  );
  const state = busy ? "busy" : dirty ? "dirty" : active ? "active" : "idle";
  return (
    <span className={statusPillClass({ state })}>
      {busy ? <Spinner size="sm" /> : active ? <BadgeCheck className="h-3 w-3" /> : <CircleOff className="h-3 w-3" />}
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
    <div className="grid h-9 shrink-0 grid-cols-3 rounded-lg border border-line bg-surface-panel p-1 shadow-sm">
      {PresetFormatOptions.map((item) => (
        <button
          key={item.value}
          type="button"
          className={cn(
            "inline-flex min-w-12 items-center justify-center rounded-md px-2 text-[11px] font-medium transition",
            value === item.value
              ? "bg-surface-panel text-content-primary shadow-sm"
              : "text-content-muted hover:text-content-primary",
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
    <div className="shrink-0 border-b border-line-subtle bg-paper-50 px-3 py-2 sm:px-5">
      <ConfigDiagnosticsList items={items} />
    </div>
  );
}
