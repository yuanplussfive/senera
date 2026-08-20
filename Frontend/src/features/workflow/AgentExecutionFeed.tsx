import { useEffect, useId, useMemo, useState, type AriaRole, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { type RunRecord } from "../../store/sessionStore";
import { deriveFeedModel, statusTextClass, type FeedGroup, type FeedItem } from "./feedModel";
import { FeedGroupIconCatalog, FeedItemIconCatalog } from "./feedPresentation";
import {
  MotionDisclosure,
  motionTimings,
  readFeedItemVariants,
  useMotionLevel,
  type MotionLevel,
} from "../../shared/motion";
import { Spinner } from "../../shared/ui/Spinner";
import { AppIcon } from "../../shared/ui/AppIcon";
import { projectToolStagePresentation } from "./toolStagePresentation";
import { runActivityPresentationPriority } from "./runActivityPresentation";
import { ToolActionIcon } from "./ToolActionIcon";
import { ToolActivityGroup } from "./ToolActivityGroup";
import { projectToolBatchActivity, ToolBatchActivity } from "./ToolBatchActivity";

type FeedStatus = FeedItem["status"];

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
export function AgentExecutionStageFeed({
  run,
  keepOpenWhileRunActive = false,
}: {
  run: RunRecord;
  keepOpenWhileRunActive?: boolean;
}): JSX.Element | null {
  const model = useMemo(() => deriveFeedModel(run), [run]);
  const presentation = useMemo(() => projectToolStagePresentation(run), [run]);
  const toolBatchActivity = useMemo(() => projectToolBatchActivity(run), [run]);
  if (!presentation || shouldShowWaitingHeadline(run, presentation.status, Boolean(toolBatchActivity))) {
    const headline = projectWaitingHeadline(run, model.headline);
    return run.status === "running" || run.status === "cancelling" || model.headline.kind === "activity" ? (
      <div className="relative min-w-0" data-execution-stage-feed>
        <FeedHeadline item={headline} />
      </div>
    ) : null;
  }

  if (toolBatchActivity) {
    return (
      <div
        className="relative w-full min-w-0"
        role="status"
        aria-label={toolBatchActivity.label}
        data-execution-stage-feed
        data-tool-stage-category={presentation.category}
        data-tool-stage-mode={presentation.mode}
        data-tool-stage-status={presentation.status}
      >
        <ToolBatchActivity
          activity={toolBatchActivity}
          defaultOpen={toolBatchActivity.live}
          keepOpenWhileRunActive={keepOpenWhileRunActive}
        />
      </div>
    );
  }

  return (
    <div
      className="relative w-full min-w-0"
      data-execution-stage-feed
      data-tool-stage-category={presentation.category}
      data-tool-stage-mode={presentation.mode}
      data-tool-stage-status={presentation.status}
    >
      <div
        className={cn(
          "tool-activity-stage-list relative min-w-0 px-0.5 text-left",
          presentation.activities.length > 1 && "tool-activity-stage-list--connected pl-5",
        )}
        role="status"
        aria-label={presentation.accessibleTitle}
        data-tool-stage-summary
      >
        {presentation.activities.map((activity) => (
          <ToolActivityGroup key={activity.id} activity={activity} defaultOpen={false} />
        ))}
      </div>
    </div>
  );
}

/** A completed preface-to-response interval. Its complete tool sequence is opt-in, not chat-height by default. */
export function AgentExecutionStageFold({ run }: { run: RunRecord }): JSX.Element | null {
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const presentation = useMemo(() => projectToolStagePresentation(run), [run]);
  const toolBatchActivity = useMemo(() => projectToolBatchActivity(run), [run]);
  const hasToolSteps = useMemo(
    () => run.steps.some((step) => step.kind === "tool" && Boolean(step.toolName?.trim())),
    [run.steps],
  );

  if (!presentation || !hasToolSteps) return <AgentExecutionStageFeed run={run} />;

  if (toolBatchActivity) {
    return (
      <div
        className="tool-batch-activity-stage min-w-0"
        data-execution-stage-fold
        data-tool-stage-category={presentation.category}
        data-tool-stage-status={presentation.status}
      >
        <ToolBatchActivity activity={toolBatchActivity} defaultOpen={false} />
      </div>
    );
  }

  return (
    <div
      className="execution-stage-fold min-w-0"
      data-execution-stage-fold
      data-tool-stage-category={presentation.category}
      data-tool-stage-status={presentation.status}
    >
      <button
        type="button"
        className="execution-stage-fold__trigger group flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-content-secondary transition-colors hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={presentation.accessibleTitle}
        onClick={() => setOpen((value) => !value)}
        data-execution-stage-fold-trigger
      >
        <ToolActionIcon icon={presentation.icon} status={presentation.status} size="xs" showLiveIndicator={false} />
        <span className="min-w-0 flex-1 truncate text-[length:var(--theme-chat-assistant-font-size)] leading-[var(--theme-chat-assistant-line-height)]">
          {presentation.title}
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-200",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      <MotionDisclosure id={contentId} open={open} className="execution-stage-fold__details">
        <div className="pt-1" data-execution-stage-fold-details>
          <ThinkingToolChain run={run} />
        </div>
      </MotionDisclosure>
    </div>
  );
}

export function ThinkingToolChain({ run }: { run: RunRecord }): JSX.Element {
  const toolBatchActivity = projectToolBatchActivity(run);

  if (toolBatchActivity) return <ToolBatchActivity activity={toolBatchActivity} defaultOpen={false} />;

  return (
    <div className="relative min-w-0 pl-5 text-[12.5px] leading-5 text-content-primary" data-thinking-tool-chain>
      <span className="text-content-muted">{frontendMessage("workflow.summary.noToolCalls")}</span>
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
  const icon = FeedGroupIconCatalog[variant];
  const status = summarizeGroupStatus(group);

  return (
    <div className="relative flex min-w-0 items-start gap-2.5" role="listitem" data-feed-group-variant={variant}>
      <TimelineMarker status={status}>
        {group.toolIcons?.length ? (
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        ) : (
          <AppIcon icon={icon} size={14} aria-hidden="true" />
        )}
      </TimelineMarker>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex min-h-5 min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {group.toolIcons?.[0] ? (
            <ToolActionIcon icon={group.toolIcons[0]} status={status} className="self-center" />
          ) : null}
          <span className="min-w-0 flex-1 basis-48 break-words text-[12.75px] font-medium text-content-primary">
            {group.label}
          </span>
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
  const icon = FeedGroupIconCatalog[variant];
  const contentId = useId();
  const status = summarizeGroupStatus(group);

  return (
    <div className="relative flex min-w-0 items-start gap-2.5" role="listitem" data-feed-group-variant={variant}>
      <TimelineMarker status={status}>
        {group.toolIcons?.length ? (
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        ) : (
          <AppIcon icon={icon} size={14} aria-hidden="true" />
        )}
      </TimelineMarker>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={
            group.toolAccessibleLabel
              ? frontendMessage(expanded ? "workflow.dock.collapseNode" : "workflow.dock.expandNode", {
                  title: group.toolAccessibleLabel,
                })
              : undefined
          }
          data-feed-group={group.id}
          className={cn(
            "group -mx-1 flex min-h-8 w-[calc(100%+0.5rem)] min-w-0 items-start gap-2 rounded px-1 py-1.5 text-left transition-colors",
            status === "failed" ? "hover:bg-brick-50" : "hover:bg-surface-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
          )}
        >
          {group.toolIcons?.[0] ? (
            <ToolActionIcon icon={group.toolIcons[0]} status={status} className="mt-0.5" />
          ) : null}
          <span className="min-w-0 flex-1 break-words text-[12.75px] font-medium leading-5 text-content-primary">
            {group.label}
          </span>
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
  const toolPresentation = item.step ? projectToolStagePresentation({ steps: [item.step] }) : undefined;
  const icon = FeedItemIconCatalog[item.kind];

  return (
    <div className="relative flex min-w-0 items-start gap-2.5" role="listitem" data-feed-item-kind={item.kind}>
      <TimelineMarker status={item.status}>
        {toolPresentation ? (
          <ToolActionIcon icon={toolPresentation.icon} status={item.status} size="xs" />
        ) : (
          <AppIcon icon={icon} size={14} aria-hidden="true" />
        )}
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
  nowEpoch,
}: {
  item: FeedItem;
  compact?: boolean;
  nowEpoch: number;
}): JSX.Element {
  return (
    <div className={cn("min-w-0 py-1.5", compact && "py-1")} role="listitem" data-feed-item-kind={item.kind}>
      <div className="flex min-w-0 items-start gap-2">
        <FeedRowStatus item={item} />
        <FeedItemContent item={item} nowEpoch={nowEpoch} />
      </div>
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
    <div className={cn("flex min-w-0 flex-1 flex-wrap items-start gap-x-2 gap-y-0.5", className)}>
      <div className="min-w-0 flex-1 basis-48">
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
        filled ? markerFilledTone(status) : markerTone(status),
        emphasis && "mt-0.5",
      )}
      data-feed-marker-status={status}
    >
      {children}
    </span>
  );
}

function markerTone(status: FeedStatus): string {
  if (status === "failed") return "text-brick-500";
  if (status === "running" || status === "cancelling") return "text-accent-content";
  return "text-content-muted";
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

function FeedRowStatus({ item }: { item: FeedItem }): JSX.Element {
  const { status } = item;
  if (item.step) {
    const presentation = projectToolStagePresentation({ steps: [item.step] });
    if (presentation) {
      return <ToolActionIcon icon={presentation.icon} status={status} size="xs" className="mt-1" />;
    }
  }
  const iconClassName = cn("mt-1 h-3 w-3 shrink-0", statusTextClass(status));
  if (status === "running") {
    return <Spinner size="xs" className={iconClassName} />;
  }
  if (status === "cancelling") return <Spinner size="xs" className={iconClassName} />;
  if (status === "failed") return <AppIcon icon="cancel" size={12} className={iconClassName} aria-hidden="true" />;
  if (status === "done") return <AppIcon icon="check" size={12} className={iconClassName} aria-hidden="true" />;
  return (
    <span
      className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current", statusTextClass(status))}
      aria-hidden="true"
    />
  );
}

function summarizeGroupStatus(group: FeedGroup): FeedStatus {
  if (group.items.some((item) => item.status === "running")) return "running";
  if (group.items.some((item) => item.status === "cancelling")) return "cancelling";
  if (group.items.some((item) => item.status === "pending")) return "pending";
  if (group.items.length > 0 && group.items.every((item) => item.status === "failed")) return "failed";
  if (group.items.every((item) => item.status === "done")) return "done";
  if (group.items.some((item) => item.status === "done")) return "done";
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
    return <Spinner size="md" className={cn(statusTextClass(status), className)} />;
  }
  if (status === "failed") {
    return <AppIcon icon="cancel" size={16} className={cn(statusTextClass(status), className)} aria-hidden="true" />;
  }
  if (status === "pending" || status === "neutral") {
    return (
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full bg-current", statusTextClass(status), className)}
        aria-hidden="true"
      />
    );
  }
  return <AppIcon icon="check" size={16} className={cn(statusTextClass(status), className)} aria-hidden="true" />;
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
    title: "Thinking...",
  };
}

function shouldShowWaitingHeadline(run: RunRecord, status: FeedStatus, hasToolPresentation: boolean): boolean {
  if (run.status !== "running" && run.status !== "cancelling") return false;
  if (run.liveActivity && runActivityPresentationPriority(run.liveActivity) === "foreground") return true;
  if (hasToolPresentation) return false;
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
