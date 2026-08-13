import { useMemo, useState } from "react";
import {
  Check,
  CirclePause,
  CirclePlay,
  CircleAlert,
  CircleCheck,
  Copy,
  Pause,
  Play,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { JsonView, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import { Virtuoso } from "react-virtuoso";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useFrontendLocale } from "../../i18n/useFrontendLocale";
import { cn } from "../../lib/util";
import { IconButton, MenuSelect, Sheet, SheetContent, Switch, useClipboardCopy } from "../../shared/ui";
import { EventPhases } from "../../api/generatedEventCatalog";
import { useEventJournalStore, type EventJournalRecord } from "./eventJournalStore";
import { eventToneClasses, isTerminalEventLayer, readEventTitle, readEventTone } from "./eventPresentation";

type DirectionFilter = "all" | EventJournalRecord["direction"];
type PhaseFilter = "all" | NonNullable<EventJournalRecord["phase"]>;

const DirectionFilters: readonly DirectionFilter[] = ["all", "inbound", "outbound", "system"];
const PhaseFilters = ["all", ...Object.values(EventPhases)] as const satisfies readonly PhaseFilter[];

export function EventMonitorPanel(): JSX.Element {
  const locale = useFrontendLocale();
  const records = useEventJournalStore((state) => state.records);
  const totalBytes = useEventJournalStore((state) => state.totalBytes);
  const recording = useEventJournalStore((state) => state.recording);
  const viewPausedAt = useEventJournalStore((state) => state.viewPausedAt);
  const wireCapture = useEventJournalStore((state) => state.wireCapture);
  const selectedId = useEventJournalStore((state) => state.selectedId);
  const setRecording = useEventJournalStore((state) => state.setRecording);
  const setViewPaused = useEventJournalStore((state) => state.setViewPaused);
  const setWireCapture = useEventJournalStore((state) => state.setWireCapture);
  const clear = useEventJournalStore((state) => state.clear);
  const select = useEventJournalStore((state) => state.select);
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [phase, setPhase] = useState<PhaseFilter>("all");

  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return records.filter((record) => {
      if (viewPausedAt !== undefined && record.localSequence > viewPausedAt) return false;
      if (direction !== "all" && record.direction !== direction) return false;
      if (phase !== "all" && record.phase !== phase) return false;
      if (!normalizedQuery) return true;
      return [record.kind, record.summary, record.requestId, record.sessionId, record.resourceId, record.connectionId]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase(locale).includes(normalizedQuery));
    });
  }, [direction, locale, phase, query, records, viewPausedAt]);
  const selected = records.find((record) => record.id === selectedId);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-surface-panel font-mono"
      aria-label={frontendMessage("observability.title")}
    >
      <div className="shrink-0 border-b border-line-subtle px-3 pb-2 pt-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              recording ? "bg-moss-500" : "bg-ink-300",
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-[10px] tabular-nums text-content-muted">
            {frontendMessage(recording ? "observability.recording" : "observability.stopped")} · {records.length} ·{" "}
            {formatByteSize(totalBytes)}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label={frontendMessage(recording ? "observability.stopRecording" : "observability.startRecording")}
              tooltip={frontendMessage(recording ? "observability.stopRecording" : "observability.startRecording")}
              size="sm"
              tone={recording ? "primary" : "muted"}
              onClick={() => setRecording(!recording)}
            >
              {recording ? <CirclePause className="h-3.5 w-3.5" /> : <CirclePlay className="h-3.5 w-3.5" />}
            </IconButton>
            <IconButton
              label={frontendMessage(
                viewPausedAt === undefined ? "observability.pauseView" : "observability.resumeView",
              )}
              tooltip={frontendMessage(
                viewPausedAt === undefined ? "observability.pauseView" : "observability.resumeView",
              )}
              size="sm"
              tone={viewPausedAt === undefined ? "muted" : "primary"}
              onClick={() => setViewPaused(viewPausedAt === undefined)}
            >
              {viewPausedAt === undefined ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </IconButton>
            <IconButton
              label={frontendMessage("observability.clear")}
              tooltip={frontendMessage("observability.clear")}
              size="sm"
              tone="muted"
              disabled={records.length === 0}
              onClick={clear}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>

        <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{frontendMessage("observability.search")}</span>
            <Search className="pointer-events-none absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 text-content-disabled" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={frontendMessage("observability.search")}
              className="h-7 w-full min-w-0 border-0 border-b border-line-subtle bg-transparent pl-5 pr-1 font-sans text-[10.5px] text-content-primary outline-none placeholder:text-content-disabled focus:border-accent-border"
            />
          </label>
          <MenuSelect
            value={direction}
            placeholder={frontendMessage("observability.direction.all")}
            ariaLabel={frontendMessage("observability.direction.label")}
            options={DirectionFilters.map((value) => ({
              value,
              label: frontendMessage(`observability.direction.${value}`),
            }))}
            triggerClassName="h-7 w-[82px] shrink-0 rounded-none border-0 border-b border-line-subtle bg-transparent px-1 text-[10px] shadow-none"
            contentClassName="min-w-[150px]"
            onChange={(value) => setDirection(value as DirectionFilter)}
          />
          <MenuSelect
            value={phase}
            placeholder={frontendMessage("observability.phase.all")}
            ariaLabel={frontendMessage("observability.phase.label")}
            options={PhaseFilters.map((value) => ({
              value,
              label: frontendMessage(`observability.phase.${value}`),
            }))}
            triggerClassName="h-7 w-[82px] shrink-0 rounded-none border-0 border-b border-line-subtle bg-transparent px-1 text-[10px] shadow-none"
            contentClassName="min-w-[140px]"
            onChange={(value) => setPhase(value as PhaseFilter)}
          />
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-3 text-[9.5px] text-content-muted">
          <span>{frontendMessage("observability.wireDescription")}</span>
          <Switch
            checked={wireCapture}
            ariaLabel={frontendMessage("observability.wireCapture")}
            onCheckedChange={setWireCapture}
            size="sm"
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {visibleRecords.length > 0 ? (
          <Virtuoso
            data={visibleRecords}
            computeItemKey={(_, record) => record.id}
            followOutput={viewPausedAt === undefined ? "auto" : false}
            itemContent={(_, record) => (
              <EventRow record={record} selected={record.id === selectedId} onSelect={() => select(record.id)} />
            )}
            className="h-full"
          />
        ) : (
          <EmptyJournal filtered={records.length > 0} />
        )}
      </div>

      <Sheet modal={false} open={selected !== undefined} onOpenChange={(open) => !open && select()}>
        <SheetContent
          side="right"
          className="w-[min(560px,92vw)] p-0"
          overlayClassName="pointer-events-none bg-transparent"
          title={selected ? readEventTitle(selected) : undefined}
          showHeader={false}
        >
          {selected ? <EventDetail record={selected} onClose={() => select()} /> : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function EventRow({
  record,
  selected,
  onSelect,
}: {
  record: EventJournalRecord;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const tone = readEventTone(record);
  const toneClasses = eventToneClasses(tone);
  const title = readEventTitle(record);
  const secondary = readEventSecondary(record, title);
  const showTechnicalKind = record.kind !== title;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group relative flex min-h-8 w-full min-w-0 items-start gap-2 px-3 py-1.5 text-left outline-none transition-colors",
        selected ? toneClasses.selected : "bg-transparent hover:bg-surface-hover/65",
        "focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus",
      )}
    >
      <time className="w-[54px] shrink-0 pt-px text-[9.5px] tabular-nums text-content-disabled">
        {formatEventTime(record.observedAt)}
      </time>
      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", toneClasses.dot)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block min-w-0 truncate font-sans text-[10.5px] leading-4 text-content-secondary group-hover:text-content-primary">
          {title}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[9px] leading-3.5 text-content-muted">
          {secondary ? <span className="min-w-0 truncate">{secondary}</span> : null}
          {showTechnicalKind ? (
            <span className="min-w-0 truncate font-mono text-content-disabled">{record.kind}</span>
          ) : null}
        </span>
      </span>
      {isTerminalEventLayer(record.layer) ? (
        <span className={cn("mt-0.5 shrink-0", tone === "error" ? "text-brick-600" : "text-moss-600")} aria-hidden="true">
          {tone === "error" ? <CircleAlert className="h-3 w-3" /> : <CircleCheck className="h-3 w-3" />}
        </span>
      ) : null}
    </button>
  );
}

function readEventSecondary(record: EventJournalRecord, title = readEventTitle(record)): string | undefined {
  if (
    record.kind === "tool.call.started" ||
    record.kind === "tool.call.completed" ||
    record.kind === "tool.call.failed"
  ) {
    return undefined;
  }
  return record.summary && record.summary !== title ? record.summary : undefined;
}

function EventDetail({ record, onClose }: { record: EventJournalRecord; onClose: () => void }): JSX.Element {
  const { copied, copyText } = useClipboardCopy();
  const detail = useMemo(() => projectRecordDetail(record), [record]);
  const toneClasses = eventToneClasses(readEventTone(record));
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-panel font-mono" data-event-detail-drawer>
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-2">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", toneClasses.dot)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-sans text-[11px] font-medium text-content-primary">{readEventTitle(record)}</div>
          <div className="truncate text-[9.5px] text-content-muted">{record.kind}</div>
        </div>
        <IconButton
          label={frontendMessage("observability.copy")}
          tooltip={frontendMessage("observability.copy")}
          size="sm"
          tone={copied ? "primary" : "muted"}
          onClick={() => void copyText(JSON.stringify(detail, null, 2))}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </IconButton>
        <IconButton
          label={frontendMessage("observability.closeDetail")}
          tooltip={frontendMessage("observability.closeDetail")}
          size="sm"
          tone="muted"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 text-[10px] leading-5">
        <JsonView
          data={detail}
          shouldExpandNode={(level) => level < 3}
          clickToExpandNode
          compactTopLevel
          style={{
            ...defaultStyles,
            container: `${defaultStyles.container} text-content-primary`,
            label: `${defaultStyles.label} text-content-primary`,
            stringValue: `${defaultStyles.stringValue} text-moss-600`,
            numberValue: `${defaultStyles.numberValue} text-accent-content`,
            booleanValue: `${defaultStyles.booleanValue} text-umber-600`,
            nullValue: `${defaultStyles.nullValue} text-content-muted`,
            punctuation: `${defaultStyles.punctuation} text-content-muted`,
            ariaLables: {
              collapseJson: frontendMessage("observability.json.collapse"),
              expandJson: frontendMessage("observability.json.expand"),
            },
          }}
          aria-label={frontendMessage("observability.detail")}
        />
      </div>
    </div>
  );
}

function EmptyJournal({ filtered }: { filtered: boolean }): JSX.Element {
  return (
    <div className="flex h-full items-start gap-2 px-3 py-4 text-[10.5px] text-content-muted">
      <span className="text-content-disabled">›</span>
      <span>{frontendMessage(filtered ? "observability.emptyFiltered" : "observability.empty")}</span>
    </div>
  );
}

function projectRecordDetail(record: EventJournalRecord): Record<string, unknown> {
  const correlation = compactRecord({
    sessionId: record.sessionId,
    requestId: record.requestId,
    commandId: record.commandId,
    resourceId: record.resourceId,
  });
  return compactRecord({
    transport: compactRecord({
      id: record.id,
      connectionId: record.connectionId,
      direction: record.direction,
      stage: record.stage,
      observedAt: record.observedAt,
      observedByteLength: record.observedByteLength,
      retainedByteLength: record.retainedByteLength,
    }),
    event: compactRecord({
      kind: record.kind,
      layer: record.layer,
      phase: record.phase,
      sequence: record.sequence,
      step: record.step,
    }),
    correlation: Object.keys(correlation).length > 0 ? correlation : undefined,
    projection: record.projection ?? (record.projectionOmitted ? { omitted: true } : null),
  });
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function formatEventTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf())
    ? timestamp
    : date.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
