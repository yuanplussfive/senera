import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CirclePause,
  CirclePlay,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Copy,
  Pause,
  Play,
  RadioTower,
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
      className="flex h-full min-h-0 flex-col bg-transparent"
      aria-label={frontendMessage("observability.title")}
    >
      <div className="shrink-0 border-b border-line-subtle bg-surface-subtle/45 px-3 pb-2.5 pt-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              recording ? "bg-moss-500 shadow-[0_0_0_3px_rgb(var(--color-moss-100)/0.65)]" : "bg-ink-300",
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium tabular-nums text-content-secondary">
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

        <div className="mt-2 flex min-w-0 items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{frontendMessage("observability.search")}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={frontendMessage("observability.search")}
              className="h-8 w-full min-w-0 rounded-md border border-line bg-surface-panel pl-8 pr-2 text-[12px] text-content-primary outline-none placeholder:text-content-disabled focus:border-accent-border focus:ring-2 focus:ring-accent-focus"
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
            triggerClassName="w-[96px] shrink-0"
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
            triggerClassName="w-[96px] shrink-0"
            contentClassName="min-w-[140px]"
            onChange={(value) => setPhase(value as PhaseFilter)}
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-content-muted">
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
  const errored = record.layer === "error" || record.stage === "malformed";
  const tone = readEventTone(record);
  const toneClasses = eventToneClasses(tone);
  const title = readEventTitle(record);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group relative flex min-h-[56px] w-full min-w-0 gap-2.5 border-b border-line-subtle px-3 py-2.5 text-left outline-none transition-colors",
        selected ? toneClasses.selected : "bg-transparent hover:bg-surface-hover",
        "focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus",
      )}
    >
      <span className="relative flex w-3 shrink-0 justify-center" aria-hidden="true">
        <span className={cn("absolute bottom-[-10px] top-[-10px] w-px", toneClasses.line)} />
        <span className={cn("relative mt-1 h-2.5 w-2.5 rounded-full ring-2 ring-inset", toneClasses.dot)} />
      </span>
      <DirectionBadge record={record} errored={errored} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-content-primary">{title}</span>
          {record.phase ? <PhaseBadge phase={record.phase} /> : null}
          <time className="shrink-0 font-mono text-[10px] tabular-nums text-content-muted">
            {formatEventTime(record.observedAt)}
          </time>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[10.5px] text-content-muted">
          <span className="shrink-0 uppercase tracking-wide">{record.stage}</span>
          {record.step !== undefined ? <span className="shrink-0">#{record.step}</span> : null}
          {record.summary ? <span className="min-w-0 truncate">{record.summary}</span> : null}
          <span className="min-w-0 truncate font-mono">{record.kind}</span>
        </span>
      </span>
      {isTerminalEventLayer(record.layer) ? (
        <span className={cn("mt-1 shrink-0", tone === "error" ? "text-brick-600" : "text-moss-600")} aria-hidden="true">
          {tone === "error" ? <CircleAlert className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}
        </span>
      ) : null}
    </button>
  );
}

function DirectionBadge({ record, errored }: { record: EventJournalRecord; errored: boolean }): JSX.Element {
  const DirectionIcon =
    record.direction === "inbound" ? ArrowDownLeft : record.direction === "outbound" ? ArrowUpRight : RadioTower;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
        directionTone(record, errored),
      )}
    >
      <DirectionIcon className="h-3.5 w-3.5" />
    </span>
  );
}

function directionTone(record: EventJournalRecord, errored: boolean): string {
  if (errored) return "bg-brick-100 text-brick-600";
  if (record.direction === "outbound") return "bg-umber-100 text-umber-600";
  if (record.direction === "inbound") return "bg-accent-surface text-accent-content";
  return "bg-ink-100 text-ink-500";
}

function PhaseBadge({ phase }: { phase: NonNullable<EventJournalRecord["phase"]> }): JSX.Element {
  return (
    <span className="shrink-0 rounded-full bg-surface-subtle px-1.5 py-px text-[9.5px] font-medium uppercase leading-4 tracking-wide text-content-muted ring-1 ring-inset ring-line-subtle">
      {phase}
    </span>
  );
}

function EventDetail({ record, onClose }: { record: EventJournalRecord; onClose: () => void }): JSX.Element {
  const { copied, copyText } = useClipboardCopy();
  const detail = useMemo(() => projectRecordDetail(record), [record]);
  const toneClasses = eventToneClasses(readEventTone(record));
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-raised" data-event-detail-drawer>
      <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line-subtle px-4 py-3">
        <span
          className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md", toneClasses.icon)}
          aria-hidden="true"
        >
          <CircleDot className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-content-primary">{readEventTitle(record)}</div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-content-muted">{record.kind}</div>
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
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-5">
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
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-subtle ring-1 ring-inset ring-line-subtle">
        <RadioTower className="h-5 w-5 text-content-muted" />
      </span>
      <p className="mt-3.5 text-[13px] font-medium text-content-primary">
        {frontendMessage(filtered ? "observability.emptyFiltered" : "observability.empty")}
      </p>
      <p className="mt-1 max-w-[280px] text-[11.5px] leading-5 text-content-muted">
        {frontendMessage(filtered ? "observability.emptyFilteredDescription" : "observability.emptyDescription")}
      </p>
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
