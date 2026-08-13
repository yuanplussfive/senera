import { lazy, Suspense, useEffect, useId, useMemo, useState, type AriaRole, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Circle, LoaderCircle, X } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { type RunRecord } from "../../store/sessionStore";
import { deriveFeedModel, statusTextClass, type FeedGroup, type FeedItem } from "./feedModel";
import { FeedGroupIconCatalog, FeedItemIconCatalog } from "./feedPresentation";
import { motionTimings, readFeedItemVariants, useMotionLevel, type MotionLevel } from "../../shared/motion";
import { Spinner } from "../../shared/ui/Spinner";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { projectToolStagePresentation } from "./toolStagePresentation";
import { runActivityPresentationPriority } from "./runActivityPresentation";

type FeedStatus = FeedItem["status"];

const ToolStepInspector = lazy(() =>
  import("./ToolStepInspector").then((module) => ({ default: module.ToolStepInspector })),
);

export function AgentExecutionFeed({ run, showBody = true }: { run: RunRecord; showBody?: boolean }): JSX.Element {
  const model = useMemo(() => deriveFeedModel(run), [run]);
  const nowEpoch = useLiveNow(run.status === "running" || run.status === "cancelling");
  const elapsedMs = readRunElapsedMs(run, nowEpoch);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
  const hasTimeline = model.groups.some((group) => group.items.length > 0);

  return (
    <div className="flex min-w-0 flex-col gap-3" data-execution-feed>
      <div className="relative min-w-0" data-execution-timeline>
        {hasTimeline ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-[7.5px] top-4 w-px bg-line-subtle"
            data-execution-rail
          />
        ) : null}
        <FeedHeadline item={model.headline} elapsedMs={elapsedMs} />
        {hasTimeline ? (
          <div className="mt-3 flex min-w-0 flex-col gap-2" role="list" aria-label={model.headline.title}>
            {model.groups.map((group) => (
              <FeedTimelineGroup
                key={group.id}
                group={group}
                expanded={expandedGroups.has(group.id)}
                onToggle={() => setExpandedGroups((current) => toggleSetEntry(current, group.id))}
                motionLevel={effectiveLevel}
                nowEpoch={nowEpoch}
              />
            ))}
          </div>
        ) : null}
      </div>
      {showBody ? (
        <div className="ml-6">
          <AnimatePresence mode="wait" initial={false}>
            {model.bodyText ? (
              <FeedMotionBlock
                key="body"
                motionLevel={effectiveLevel}
                className="pt-2 text-[length:var(--theme-chat-assistant-font-size)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary"
              >
                <span className="whitespace-pre-wrap break-words">{model.bodyText}</span>
                <span className="caret-blink" />
              </FeedMotionBlock>
            ) : (
              <PendingLine key="pending" label={model.placeholder} motionLevel={effectiveLevel} />
            )}
          </AnimatePresence>
        </div>
      ) : null}
      {model.footer ? (
        <div className="ml-6">
          <FeedMotionBlock motionLevel={effectiveLevel} className="pt-1.5 font-mono text-[10.5px] text-content-muted">
            {model.footer}
          </FeedMotionBlock>
        </div>
      ) : null}
    </div>
  );
}

/** A phase-local execution view for the conversation. The full run remains in the workflow dock. */
export function AgentExecutionStageFeed({ run }: { run: RunRecord }): JSX.Element | null {
  const model = useMemo(() => deriveFeedModel(run), [run]);
  const presentation = useMemo(() => projectToolStagePresentation(run), [run]);
  const nowEpoch = useLiveNow(run.status === "running" || run.status === "cancelling");
  const elapsedMs = readRunElapsedMs(run, nowEpoch);
  if (!presentation || shouldShowWaitingHeadline(run, presentation.status)) {
    const headline = projectWaitingHeadline(run, model.headline);
    return run.status === "running" || run.status === "cancelling" || model.headline.kind === "activity" ? (
      <div className="relative min-w-0" data-execution-stage-feed>
        <FeedHeadline item={headline} elapsedMs={elapsedMs} />
      </div>
    ) : null;
  }

  return (
    <div
      className="relative min-w-0"
      data-execution-stage-feed
      data-tool-stage-category={presentation.category}
      data-tool-stage-mode={presentation.mode}
    >
      <div
        className="inline-flex min-h-5 max-w-full min-w-0 items-start gap-2 px-0.5 text-left"
        role="status"
        aria-label={presentation.title}
        data-tool-stage-summary
      >
        <span className="mt-0.5 shrink-0">
          <StageStatusIcon status={presentation.status} />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 break-words text-[12.75px] font-medium leading-5 text-content-secondary">
              {presentation.title}
            </span>
            {isLiveFeedStatus(presentation.status) && elapsedMs !== undefined ? (
              <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-content-muted" data-feed-elapsed>
                {formatFeedElapsed(elapsedMs)}
              </span>
            ) : null}
          </span>
          {presentation.summary ? (
            <span className="block break-words text-[11px] leading-4 text-content-muted" data-tool-stage-result-summary>
              {presentation.summary}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function FeedTimelineGroup({
  group,
  expanded,
  onToggle,
  motionLevel,
  nowEpoch,
}: {
  group: FeedGroup;
  expanded: boolean;
  onToggle: () => void;
  motionLevel: MotionLevel;
  nowEpoch: number;
}): JSX.Element {
  if (group.variant === "trace" && !group.collapsible) {
    return (
      <>
        {group.items.map((item) => (
          <TimelineFeedItem key={item.id} item={item} nowEpoch={nowEpoch} />
        ))}
      </>
    );
  }

  if (group.collapsible) {
    return (
      <FeedGroupBlock
        group={group}
        expanded={expanded}
        onToggle={onToggle}
        motionLevel={motionLevel}
        nowEpoch={nowEpoch}
      />
    );
  }

  return <FeedGroupRows group={group} nowEpoch={nowEpoch} />;
}

function FeedGroupRows({ group, nowEpoch }: { group: FeedGroup; nowEpoch: number }): JSX.Element {
  const variant = group.variant ?? "trace";
  const Icon = FeedGroupIconCatalog[variant];

  return (
    <div className="relative flex min-w-0 items-start gap-2.5" role="listitem" data-feed-group-variant={variant}>
      <TimelineMarker status={summarizeGroupStatus(group)}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </TimelineMarker>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex min-h-5 min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 text-[12.75px] font-medium text-content-primary">{group.label}</span>
          {group.meta ? (
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-content-muted">{group.meta}</span>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 flex-col gap-0.5" role="list">
          {group.items.map((item) => (
            <FeedRow key={item.id} item={item} compact nowEpoch={nowEpoch} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeedHeadline({ item, elapsedMs }: { item: FeedItem; elapsedMs?: number }): JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <TimelineMarker status={item.status} emphasis filled>
        <FeedStatusIcon status={item.status} />
      </TimelineMarker>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-medium leading-5 text-content-primary">{item.title}</span>
          {isLiveFeedStatus(item.status) && elapsedMs !== undefined ? (
            <span className="font-mono text-[10.5px] tabular-nums text-content-muted" data-feed-elapsed>
              {formatFeedElapsed(elapsedMs)}
            </span>
          ) : null}
          {item.meta ? <span className="text-[10.5px] tabular-nums text-content-muted">{item.meta}</span> : null}
        </div>
        {item.subtitle ? (
          <div className="mt-1 break-words text-[12px] leading-relaxed text-content-secondary">{item.subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}

function FeedGroupBlock({
  group,
  expanded,
  onToggle,
  motionLevel,
  nowEpoch,
}: {
  group: FeedGroup;
  expanded: boolean;
  onToggle: () => void;
  motionLevel: MotionLevel;
  nowEpoch: number;
}): JSX.Element {
  const variant = group.variant ?? "trace";
  const Icon = FeedGroupIconCatalog[variant];
  const contentId = useId();
  const status = summarizeGroupStatus(group);

  return (
    <div className="relative flex min-w-0 items-start gap-2.5" role="listitem" data-feed-group-variant={variant}>
      <TimelineMarker status={status}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </TimelineMarker>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          data-feed-group={group.id}
          className={cn(
            "group -mx-1 flex min-h-8 w-[calc(100%+0.5rem)] min-w-0 items-center gap-2 rounded px-1 text-left transition-colors",
            status === "failed" ? "hover:bg-brick-50" : "hover:bg-surface-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-[12.75px] font-medium text-content-primary">{group.label}</span>
          {group.meta ? (
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-content-muted">{group.meta}</span>
          ) : null}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-200",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        <AnimatePresence initial={false}>
          {expanded ? (
            <FeedMotionBlock key="details" motionLevel={motionLevel}>
              <div
                id={contentId}
                className="mt-1 flex min-w-0 flex-col border-l border-line-subtle pl-3"
                role="list"
                data-feed-detail-surface
              >
                {group.items.map((item) => (
                  <FeedRow key={item.id} item={item} compact nowEpoch={nowEpoch} />
                ))}
              </div>
            </FeedMotionBlock>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function TimelineFeedItem({ item, nowEpoch }: { item: FeedItem; nowEpoch: number }): JSX.Element {
  const Icon = FeedItemIconCatalog[item.kind];

  return (
    <div className="relative flex min-w-0 items-start gap-2.5" role="listitem" data-feed-item-kind={item.kind}>
      <TimelineMarker status={item.status}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </TimelineMarker>
      <FeedItemContent
        item={item}
        nowEpoch={nowEpoch}
        className={cn("min-h-5 pb-1", item.status === "failed" && "-mt-1 border-l-2 border-brick-400 py-1 pl-2")}
      />
    </div>
  );
}

function FeedRow({
  item,
  compact = false,
  detailMode = "popover",
  nowEpoch,
}: {
  item: FeedItem;
  compact?: boolean;
  detailMode?: "inline" | "popover";
  nowEpoch: number;
}): JSX.Element {
  const expandable = item.kind === "tool" && item.step !== undefined;
  const [inlineExpanded, setInlineExpanded] = useState(false);

  if (expandable && detailMode === "inline") {
    return (
      <div className={cn("min-w-0 py-1.5", compact && "py-1")} role="listitem" data-feed-item-kind={item.kind}>
        <button
          type="button"
          className="group flex w-full min-w-0 items-start gap-2 rounded px-0.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
          aria-expanded={inlineExpanded}
          aria-label={frontendMessage(inlineExpanded ? "workflow.dock.collapseNode" : "workflow.dock.expandNode", {
            title: item.title,
          })}
          onClick={() => setInlineExpanded((value) => !value)}
        >
          <FeedRowStatus status={item.status} />
          <FeedItemContent item={item} nowEpoch={nowEpoch} />
          <ChevronDown
            className={cn(
              "mt-1 h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-200",
              inlineExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        {inlineExpanded ? (
          <div className="ml-4 mt-1 border-l border-line-subtle pl-3" data-feed-inline-tool-detail>
            <Suspense fallback={<ToolInspectorLoading />}>
              <ToolStepInspector step={item.step!} showHeader={false} />
            </Suspense>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("min-w-0 py-1.5", compact && "py-1")} role="listitem" data-feed-item-kind={item.kind}>
      {expandable ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="group flex w-full min-w-0 items-start gap-2 rounded px-0.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
              aria-label={frontendMessage("workflow.dock.expandNode", { title: item.title })}
            >
              <FeedRowStatus status={item.status} />
              <FeedItemContent item={item} nowEpoch={nowEpoch} />
              <ChevronDown
                className="mt-1 h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-200 group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(34rem,calc(100vw-2rem))] p-0" data-feed-tool-detail>
            <Suspense fallback={<ToolInspectorLoading />}>
              <ToolStepInspector step={item.step!} />
            </Suspense>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex min-w-0 items-start gap-2">
          <FeedRowStatus status={item.status} />
          <FeedItemContent item={item} nowEpoch={nowEpoch} />
        </div>
      )}
    </div>
  );
}

function ToolInspectorLoading(): JSX.Element {
  return (
    <div className="flex min-h-20 items-center gap-2 px-4 py-3 text-[11.5px] text-content-muted" role="status">
      <Spinner size="xs" />
      <span>{frontendMessage("ui.loading")}</span>
    </div>
  );
}

function FeedItemContent({
  item,
  className,
  nowEpoch,
}: {
  item: FeedItem;
  className?: string;
  nowEpoch: number;
}): JSX.Element {
  const elapsedMs = readStepElapsedMs(item.step, nowEpoch);
  return (
    <div className={cn("flex min-w-0 flex-1 items-start gap-2", className)}>
      <div className="min-w-0 flex-1">
        <div className="break-words text-[12.75px] leading-5 text-content-primary">{item.title}</div>
        {item.subtitle ? (
          <div className="mt-0.5 break-words text-[11.5px] leading-[1.45] text-content-secondary">{item.subtitle}</div>
        ) : null}
      </div>
      {item.meta || elapsedMs !== undefined ? (
        <span className={cn("shrink-0 pt-px text-[11px] leading-5", statusTextClass(item.status))}>
          {[item.meta, elapsedMs === undefined ? undefined : formatFeedElapsed(elapsedMs)].filter(Boolean).join(" · ")}
        </span>
      ) : null}
    </div>
  );
}

function TimelineMarker({
  status,
  emphasis = false,
  filled = false,
  children,
}: {
  status: FeedStatus;
  emphasis?: boolean;
  filled?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-canvas text-content-muted ring-[3px] ring-surface-canvas",
        filled ? markerFilledTone(status) : statusTextClass(status),
        emphasis && "mt-0.5",
      )}
      data-feed-marker-status={status}
    >
      {children}
    </span>
  );
}

function markerFilledTone(status: FeedStatus): string {
  switch (status) {
    case "running":
      return "bg-accent-surface text-accent-content";
    case "cancelling":
      return "bg-accent-surface text-accent-content";
    case "done":
      return "bg-moss-100 text-moss-600";
    case "failed":
      return "bg-brick-100 text-brick-600";
    default:
      return "bg-ink-100 text-ink-500";
  }
}

function FeedRowStatus({ status }: { status: FeedStatus }): JSX.Element {
  const iconClassName = cn("mt-1 h-3 w-3 shrink-0", statusTextClass(status));
  if (status === "running") {
    return <Spinner size="xs" className={iconClassName} />;
  }
  if (status === "cancelling") return <LoaderCircle className={cn(iconClassName, "animate-spin")} aria-hidden="true" />;
  if (status === "failed") return <X className={iconClassName} aria-hidden="true" />;
  if (status === "done") return <Check className={iconClassName} aria-hidden="true" />;
  return <Circle className={cn(iconClassName, "h-2.5 w-2.5")} aria-hidden="true" />;
}

function summarizeGroupStatus(group: FeedGroup): FeedStatus {
  if (group.items.some((item) => item.status === "failed")) return "failed";
  if (group.items.some((item) => item.status === "running")) return "running";
  if (group.items.some((item) => item.status === "cancelling")) return "cancelling";
  if (group.items.some((item) => item.status === "pending")) return "pending";
  if (group.items.every((item) => item.status === "done")) return "done";
  return "neutral";
}

function toggleSetEntry(values: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function FeedStatusIcon({ status, className }: { status: FeedStatus; className?: string }): JSX.Element {
  if (status === "running") return <Spinner size="md" className={cn(statusTextClass(status), className)} />;
  if (status === "cancelling") {
    return <LoaderCircle className={cn("h-4 w-4 shrink-0 animate-spin", statusTextClass(status), className)} />;
  }
  if (status === "failed") return <X className={cn("h-4 w-4 shrink-0", statusTextClass(status), className)} />;
  if (status === "pending" || status === "neutral") {
    return <Circle className={cn("h-3 w-3 shrink-0", statusTextClass(status), className)} />;
  }
  return <Check className={cn("h-4 w-4 shrink-0", statusTextClass(status), className)} />;
}

function StageStatusIcon({ status }: { status: FeedStatus }): JSX.Element {
  if (status === "running") return <Spinner size="sm" className={cn("shrink-0", statusTextClass(status))} />;
  if (status === "cancelling") {
    return (
      <LoaderCircle className={cn("h-3.5 w-3.5 shrink-0 animate-spin", statusTextClass(status))} aria-hidden="true" />
    );
  }
  if (status === "failed")
    return <X className={cn("h-3.5 w-3.5 shrink-0", statusTextClass(status))} aria-hidden="true" />;
  if (status === "pending" || status === "neutral") {
    return <Circle className={cn("h-3 w-3 shrink-0", statusTextClass(status))} aria-hidden="true" />;
  }
  return <Check className={cn("h-3.5 w-3.5 shrink-0", statusTextClass(status))} aria-hidden="true" />;
}

function isLiveFeedStatus(status: FeedStatus): boolean {
  return status === "running" || status === "cancelling";
}

function formatFeedElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (totalSeconds < 60) {
    return frontendFeatureMessage("workflow.feed.elapsed.seconds", { seconds: totalSeconds });
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return frontendFeatureMessage("workflow.feed.elapsed.minutes", { minutes: totalMinutes, seconds });
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return frontendFeatureMessage("workflow.feed.elapsed.hours", { hours, minutes, seconds });
}

function useLiveNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  return now;
}

function readRunElapsedMs(run: RunRecord, nowEpoch: number): number | undefined {
  const start = Date.parse(run.startedAt);
  if (!Number.isFinite(start)) return undefined;
  const live = run.status === "running" || run.status === "cancelling";
  const end = live ? nowEpoch : run.endedAt ? Date.parse(run.endedAt) : undefined;
  if (end === undefined || !Number.isFinite(end)) return undefined;
  return Math.max(0, end - start);
}

function projectWaitingHeadline(run: RunRecord, headline: FeedItem): FeedItem {
  if (run.liveActivity && runActivityPresentationPriority(run.liveActivity) === "foreground") return headline;
  if (headline.status === "cancelling") return headline;
  return {
    id: "live-waiting",
    kind: "trace",
    status: "running",
    title: frontendFeatureMessage("workflow.feed.thinking"),
  };
}

function shouldShowWaitingHeadline(run: RunRecord, status: FeedStatus): boolean {
  if (run.status !== "running" && run.status !== "cancelling") return false;
  if (run.liveActivity && runActivityPresentationPriority(run.liveActivity) === "foreground") return true;
  if (isLiveFeedStatus(status)) return false;
  if (["pending", "streaming"].includes(run.outputState)) return true;
  return run.visibleKind === "tool_calls" || run.visibleKind === "tool_preface";
}

function readStepElapsedMs(step: FeedItem["step"] | undefined, nowEpoch: number): number | undefined {
  if (!step || !isLiveFeedStatus(step.status)) return undefined;
  const start = Date.parse(step.startedAt);
  return Number.isFinite(start) ? Math.max(0, nowEpoch - start) : undefined;
}

function FeedMotionBlock({
  children,
  className,
  motionLevel,
  role,
  ariaLive,
}: {
  children: ReactNode;
  className?: string;
  motionLevel: MotionLevel;
  role?: AriaRole;
  ariaLive?: "off" | "polite" | "assertive";
}): JSX.Element {
  return (
    <motion.div
      variants={readFeedItemVariants(motionLevel)}
      initial="hidden"
      animate="show"
      exit="exit"
      transition={motionLevel === "none" ? { duration: 0 } : motionTimings.base}
      className={className}
      role={role}
      aria-live={ariaLive}
    >
      {children}
    </motion.div>
  );
}

function PendingLine({ label, motionLevel }: { label: string; motionLevel: MotionLevel }): JSX.Element {
  return (
    <FeedMotionBlock
      motionLevel={motionLevel}
      className="my-1.5 inline-flex max-w-full items-center gap-2 py-1 text-[12.75px] leading-relaxed text-content-secondary"
      role="status"
      ariaLive="polite"
    >
      <Spinner size="sm" className="text-content-secondary" />
      <span className="min-w-0 truncate">{label}</span>
    </FeedMotionBlock>
  );
}
