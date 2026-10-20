import { useEffect, useId, useMemo, useState, type AriaRole, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { type RunRecord, type TimelineChildRunState, type TimelineStep } from "../../store/sessionStore";
import {
  deriveFeedModel,
  splitStageChildRuns,
  statusTextClass,
  type FeedGroup,
  type FeedItem,
  type StageChildRunEntry,
} from "./feedModel";
import { FeedGroupIconCatalog, FeedItemIconCatalog } from "./feedPresentation";
import {
  MotionDisclosure,
  StableActivitySlot,
  TextShimmer,
  motionTimings,
  readFeedItemVariants,
  useMotionLevel,
  type MotionLevel,
} from "../../shared/motion";
import { AppIcon, ActivityLoader, ExecutionStatusTones, StatusGlyph, type AppIconName } from "../../shared/ui";
import { projectToolStagePresentation } from "./toolStagePresentation";
import { hasVisibleRunFeedback, runActivityPresentationPriority } from "./runActivityPresentation";
import { ToolActionIcon } from "./ToolActionIcon";
import { ToolActivityGroup } from "./ToolActivityGroup";
import { ToolActivityLabel } from "./ToolActivityLabel";
import { projectToolBatchActivities, ToolBatchActivityList } from "./ToolBatchActivity";
import { ChildRunActivity } from "./ChildRunCard";
import { LiveActivityStatus } from "./LiveActivityStatus";

type FeedStatus = FeedItem["status"];

export function AgentExecutionFeed({ run, showBody = true }: { run: RunRecord; showBody?: boolean }): JSX.Element {
  const model = useMemo(() => deriveFeedModel(run), [run]);
  const nowEpoch = useLiveNow(run.status === "running" || run.status === "cancelling");
  const elapsedMs = readRunElapsedMs(run, nowEpoch);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
  // Delegation groups intentionally keep their internal tool rows out of the
  // parent timeline. Their child-run projection is still a visible timeline
  // item, even though `items` is empty.
  const hasTimeline = model.groups.some((group) => group.items.length > 0 || Boolean(group.childRun));
  const live = run.status === "running" || run.status === "cancelling";
  const showInitialWait = live && !hasVisibleRunFeedback(run, { includeWorkflowTrace: true });
  const animateBody = live && Boolean(model.bodyText);

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
        {showInitialWait ? (
          <PendingLine label={model.placeholder} />
        ) : (
          <FeedHeadline item={model.headline} elapsedMs={elapsedMs} liveActivity={live && !animateBody} />
        )}
        {hasTimeline ? (
          <div
            className="mt-3 flex min-w-0 flex-col gap-2"
            role="list"
            aria-label={model.headline.title}
            data-execution-timeline-list
          >
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
      {showBody && model.bodyText ? (
        <div className="ml-6" data-execution-feed-body>
          <FeedMotionBlock
            key="body"
            motionLevel={effectiveLevel}
            className="pt-2 text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary"
          >
            <TextShimmer text={model.bodyText} active={animateBody} />
            <span className="caret-blink" />
          </FeedMotionBlock>
        </div>
      ) : null}
      {model.footer ? (
        <div className="ml-6" data-execution-feed-footer>
          <FeedMotionBlock motionLevel={effectiveLevel} className="pt-1.5 text-[10.5px] text-content-muted">
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
  liveActivity,
  showWaitingActivity = true,
}: {
  run: RunRecord;
  keepOpenWhileRunActive?: boolean;
  liveActivity?: boolean;
  showWaitingActivity?: boolean;
}): JSX.Element | null {
  const model = useMemo(() => deriveFeedModel(run), [run]);
  const split = useMemo(() => splitStageChildRuns(run.steps), [run.steps]);
  const presentation = useMemo(() => projectToolStagePresentation({ steps: split.rootToolSteps }), [split]);
  const toolBatchActivities = useMemo(
    () => projectToolBatchActivities({ steps: split.rootToolSteps }),
    [split.rootToolSteps],
  );
  const activityOwner = liveActivity ?? (run.status === "running" || run.status === "cancelling");
  const liveRun = isLiveRun(run);
  const hasChildRuns = split.childRuns.length > 0;
  if (!presentation && !hasChildRuns) {
    const headline = projectWaitingHeadline(run, model.headline);
    if (!showWaitingActivity && isGenericWaitingHeadline(headline)) {
      return liveRun ? <LiveActivityStatus dataFallback /> : null;
    }
    return liveRun || model.headline.kind === "activity" ? (
      <div className="relative min-w-0" data-execution-stage-feed>
        <FeedHeadline item={headline} liveActivity={activityOwner} />
      </div>
    ) : null;
  }
  if (
    presentation &&
    shouldShowWaitingHeadline(run, presentation.status, toolBatchActivities.length > 0 || hasChildRuns)
  ) {
    const headline = projectWaitingHeadline(run, model.headline);
    if (!showWaitingActivity && isGenericWaitingHeadline(headline)) {
      return liveRun ? <LiveActivityStatus dataFallback /> : null;
    }
    return liveRun || model.headline.kind === "activity" ? (
      <div className="relative min-w-0" data-execution-stage-feed>
        <FeedHeadline item={headline} liveActivity={activityOwner} />
      </div>
    ) : null;
  }

  const childRunActivities = hasChildRuns ? <ChildRunActivityList entries={split.childRuns} /> : null;

  if (toolBatchActivities.length > 0) {
    return (
      <>
        {childRunActivities}
        <div
          className="relative w-full min-w-0"
          role="status"
          aria-label={toolBatchActivities[0]?.label ?? presentation?.accessibleTitle}
          data-execution-stage-feed
          data-tool-stage-category={presentation?.category}
          data-tool-stage-mode={presentation?.mode}
          data-tool-stage-status={presentation?.status}
        >
          <ToolBatchActivityList
            activities={toolBatchActivities}
            keepOpenWhileRunActive={keepOpenWhileRunActive}
            animateActivity={activityOwner}
          />
        </div>
      </>
    );
  }

  if (!presentation) {
    return hasChildRuns ? (
      <div className="relative w-full min-w-0" data-execution-stage-feed>
        {childRunActivities}
      </div>
    ) : null;
  }

  return (
    <>
      {childRunActivities}
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
    </>
  );
}

/** A completed preface-to-response interval. Its complete tool sequence is opt-in, not chat-height by default. */
export function AgentExecutionStageFold({
  run,
  showWaitingActivity = true,
}: {
  run: RunRecord;
  showWaitingActivity?: boolean;
}): JSX.Element | null {
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const split = useMemo(() => splitStageChildRuns(run.steps), [run.steps]);
  const presentation = useMemo(() => projectToolStagePresentation({ steps: split.rootToolSteps }), [split]);
  const toolBatchActivities = useMemo(
    () => projectToolBatchActivities({ steps: split.rootToolSteps }),
    [split.rootToolSteps],
  );
  const hasExecutionContent = split.rootToolSteps.length > 0 || split.childRuns.length > 0;

  if (!presentation || !hasExecutionContent) {
    return <AgentExecutionStageFeed run={run} showWaitingActivity={showWaitingActivity} />;
  }

  const childRunActivities = <ChildRunActivityList entries={split.childRuns} />;

  if (toolBatchActivities.length > 0) {
    return (
      <div
        className="tool-batch-activity-stage flex min-w-0 flex-col gap-1"
        data-execution-stage-fold
        data-tool-stage-category={presentation.category}
        data-tool-stage-status={presentation.status}
      >
        {childRunActivities}
        <ToolBatchActivityList activities={toolBatchActivities} />
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
        className="execution-stage-fold__trigger group inline-flex max-w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-content-secondary transition-colors hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={presentation.accessibleTitle}
        onClick={() => setOpen((value) => !value)}
        data-execution-stage-fold-trigger
      >
        <ToolActionIcon icon={presentation.icon} status={presentation.status} size="sm" />
        <span className="min-w-0 truncate text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-[var(--theme-chat-assistant-line-height)]">
          {presentation.title}
        </span>
        <AppIcon
          icon="chevron-right"
          size={14}
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-200",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      <MotionDisclosure id={contentId} open={open} className="execution-stage-fold__details">
        <div className="flex flex-col gap-1 pt-1" data-execution-stage-fold-details>
          {childRunActivities}
          <ThinkingToolChain steps={split.rootToolSteps} />
        </div>
      </MotionDisclosure>
    </div>
  );
}

export function ThinkingToolChain({ run, steps }: { run?: RunRecord; steps?: readonly TimelineStep[] }): JSX.Element {
  const sourceSteps = steps ?? run?.steps ?? [];
  const split = splitStageChildRuns(sourceSteps);
  const toolBatchActivities = projectToolBatchActivities({ steps: split.rootToolSteps });

  if (toolBatchActivities.length === 0 && split.childRuns.length === 0) {
    return (
      <div className="relative min-w-0 pl-5 text-[12.5px] leading-5 text-content-primary" data-thinking-tool-chain>
        <span className="text-content-muted">{frontendMessage("workflow.summary.noToolCalls")}</span>
      </div>
    );
  }

  // Preserve the legacy single-batch DOM when no child runs participate, so hosts
  // that style around [data-tool-batch-activity] keep their structure.
  if (split.childRuns.length === 0 && toolBatchActivities.length > 0) {
    return <ToolBatchActivityList activities={toolBatchActivities} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-1" data-thinking-tool-chain>
      <ChildRunActivityList entries={split.childRuns} />
      {toolBatchActivities.length > 0 ? <ToolBatchActivityList activities={toolBatchActivities} /> : null}
    </div>
  );
}

function ChildRunActivityList({ entries }: { entries: readonly StageChildRunEntry[] }): JSX.Element | null {
  if (entries.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-stage-child-run-activities data-stage-child-run-cards>
      {entries.map((entry) => (
        <ChildRunActivity
          key={entry.childRun.id}
          childRun={entry.childRun}
          agentName={entry.agentName}
          childToolSteps={entry.childToolSteps}
        />
      ))}
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
  if (group.variant === "delegation" && group.childRun) {
    return (
      <div
        className="execution-feed-item execution-feed-item--delegation relative min-w-0"
        role="listitem"
        data-feed-group-variant="delegation"
      >
        <TimelineMarker status={summarizeChildRunStatus(group.childRun)}>
          <AppIcon icon="delegation" size={14} aria-hidden="true" />
        </TimelineMarker>
        <div className="execution-feed-item__body min-w-0">
          <ChildRunActivity
            childRun={group.childRun}
            agentName={group.agentName}
            childToolSteps={group.childToolSteps}
          />
        </div>
      </div>
    );
  }

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
    <div
      className="execution-feed-item execution-feed-group relative min-w-0"
      role="listitem"
      data-feed-group-variant={variant}
    >
      <TimelineMarker status={status}>
        {group.toolIcons?.[0] ? (
          <ToolActionIcon icon={group.toolIcons[0]} status={status} size="sm" />
        ) : (
          <AppIcon icon={icon} size={14} aria-hidden="true" />
        )}
      </TimelineMarker>
      <div className="execution-feed-group__body min-w-0">
        <div className="execution-feed-group__meta flex min-w-0 flex-wrap items-baseline">
          <span className="min-w-0 flex-1 basis-48 break-words text-[12.75px] font-medium text-content-primary">
            {group.label}
          </span>
          {group.meta ? (
            <span className="shrink-0 text-[10.5px] tabular-nums text-content-muted">{group.meta}</span>
          ) : null}
        </div>
        <div className="execution-feed-group__items flex min-w-0 flex-col" role="list">
          {group.items.map((item) => (
            <FeedRow key={item.id} item={item} compact nowEpoch={nowEpoch} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeedHeadline({
  item,
  elapsedMs,
  liveActivity = false,
}: {
  item: FeedItem;
  elapsedMs?: number;
  liveActivity?: boolean;
}): JSX.Element {
  return (
    <StableActivitySlot stateKey={`${item.id}:${item.status}`} geometry="content">
      <div className="execution-feed-headline min-w-0">
        <TimelineMarker status={item.status} emphasis filled liveActivity={liveActivity && !item.step}>
          <FeedStatusIcon item={item} />
        </TimelineMarker>
        <div className="execution-feed-headline__body min-w-0">
          <div className="execution-feed-headline__meta flex min-w-0 flex-wrap items-center">
            <span
              className="execution-feed-headline__title text-[13px] font-medium text-content-primary"
              data-live-activity-text={liveActivity || undefined}
            >
              <ToolActivityLabel inspection={item.toolActivity} fallback={item.title} />
            </span>
            {isLiveFeedStatus(item.status) && elapsedMs !== undefined ? (
              <span className="text-[10.5px] tabular-nums text-content-muted" data-feed-elapsed>
                {formatFeedElapsed(elapsedMs)}
              </span>
            ) : null}
            {item.meta ? <span className="text-[10.5px] tabular-nums text-content-muted">{item.meta}</span> : null}
          </div>
          {item.subtitle ? (
            <div className="execution-feed-headline__subtitle break-words text-[12px] text-content-secondary">
              {item.subtitle}
            </div>
          ) : null}
        </div>
      </div>
    </StableActivitySlot>
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
    <div
      className="execution-feed-item execution-feed-group relative min-w-0"
      role="listitem"
      data-feed-group-variant={variant}
    >
      <TimelineMarker status={status}>
        {group.toolIcons?.[0] ? (
          <ToolActionIcon icon={group.toolIcons[0]} status={status} size="sm" />
        ) : (
          <AppIcon icon={icon} size={14} aria-hidden="true" />
        )}
      </TimelineMarker>
      <div className="execution-feed-group__body min-w-0">
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
            "execution-feed-group__trigger group -mx-1 flex min-w-0 items-center rounded px-1 text-left transition-colors",
            status === "failed" ? "hover:bg-brick-50" : "hover:bg-surface-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
          )}
        >
          <span className="min-w-0 flex-1 break-words text-[12.75px] font-medium leading-5 text-content-primary">
            {group.label}
          </span>
          {group.meta ? (
            <span className="shrink-0 text-[10px] tabular-nums text-content-muted">{group.meta}</span>
          ) : null}
          <AppIcon
            icon="chevron-down"
            size={14}
            className={cn("shrink-0 text-content-muted transition-transform duration-200", expanded && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        <AnimatePresence initial={false}>
          {expanded ? (
            <FeedMotionBlock key="details" motionLevel={motionLevel}>
              <div
                id={contentId}
                className="execution-feed-group__details flex min-w-0 flex-col border-l border-line-subtle pl-3"
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
  const icon = item.step?.kind === "recall" ? "book-open" : FeedItemIconCatalog[item.kind];

  return (
    <div className="execution-feed-item relative min-w-0" role="listitem" data-feed-item-kind={item.kind}>
      <TimelineMarker status={item.status}>
        {toolPresentation ? (
          <ToolActionIcon icon={toolPresentation.icon} status={item.status} size="sm" />
        ) : (
          <AppIcon icon={icon} size={14} aria-hidden="true" />
        )}
      </TimelineMarker>
      <FeedItemContent
        item={item}
        nowEpoch={nowEpoch}
        className={cn("execution-feed-item__body", item.status === "failed" && "execution-feed-item__body--failed")}
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
    <div
      className={cn("execution-feed-row min-w-0", compact && "execution-feed-row--compact")}
      role="listitem"
      data-feed-item-kind={item.kind}
    >
      <div className="execution-feed-row__layout min-w-0">
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
    <div className={cn("execution-feed-item-content min-w-0", className)}>
      <div className="min-w-0 flex-1 basis-48">
        <div className="execution-feed-item-content__title break-words text-[12.75px] text-content-primary">
          <ToolActivityLabel inspection={item.toolActivity} fallback={item.title} />
        </div>
        {item.subtitle ? (
          <div className="execution-feed-item-content__subtitle break-words text-[11.5px] text-content-secondary">
            {item.subtitle}
          </div>
        ) : null}
      </div>
      {item.meta || elapsedMs !== undefined ? (
        <span className={cn("execution-feed-item-content__meta shrink-0 text-[11px]", statusTextClass(item.status))}>
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
  liveActivity = false,
  children,
}: {
  status: FeedStatus;
  emphasis?: boolean;
  filled?: boolean;
  liveActivity?: boolean;
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
      data-workflow-live-marker={liveActivity || undefined}
    >
      {children}
    </span>
  );
}

function markerTone(status: FeedStatus): string {
  return ExecutionStatusTones[status].text;
}

function markerFilledTone(status: FeedStatus): string {
  return ExecutionStatusTones[status].wash;
}

function FeedRowStatus({ item }: { item: FeedItem }): JSX.Element {
  const { status } = item;
  if (item.step) {
    const presentation = projectToolStagePresentation({ steps: [item.step] });
    if (presentation) {
      return <ToolActionIcon icon={presentation.icon} status={status} size="sm" className="mt-1" />;
    }
  }
  const glyphClassName = "mt-1 h-3 w-3 shrink-0";
  if (status === "running") {
    return <ActivityLoader size={12} className={glyphClassName} active data-execution-status-icon={status} />;
  }
  return (
    <StatusGlyph status={status} className={glyphClassName}>
      <AppIcon icon={readStaticFeedGlyph(status)} size={12} />
    </StatusGlyph>
  );
}

/** Cancelling keeps the "stop" glyph rather than a spinner: the run is winding
    down, not doing new work. */
function readStaticFeedGlyph(status: FeedStatus): AppIconName {
  if (status === "done") return "check";
  if (status === "failed" || status === "cancelling") return "cancel";
  return "circle";
}

function summarizeChildRunStatus(childRun: TimelineChildRunState): FeedStatus {
  switch (childRun.status) {
    case "queued":
    case "awaiting_supervisor":
      return "pending";
    case "running":
    case "wrapping_up":
      return "running";
    case "cancelling":
      return "cancelling";
    case "failed":
    case "timed_out":
      return "failed";
    case "completed":
    case "partial_completed":
    case "interrupted":
    case "cancelled":
      return "done";
  }
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

function FeedStatusIcon({ item }: { item: FeedItem }): JSX.Element {
  const { status } = item;
  const toolPresentation = item.step ? projectToolStagePresentation({ steps: [item.step] }) : undefined;
  if (toolPresentation) {
    return <ToolActionIcon icon={toolPresentation.icon} status={status} size="sm" />;
  }
  if (item.id === "live" || item.id === "live-waiting" || status === "running") {
    return <ActivityLoader size={16} active data-execution-status-icon="running" />;
  }
  if (status === "done") {
    return (
      <StatusGlyph status={status}>
        <AppIcon icon="check" size={16} />
      </StatusGlyph>
    );
  }
  if (status === "failed" || status === "cancelling") {
    return (
      <StatusGlyph status={status}>
        <AppIcon icon="cancel" size={16} />
      </StatusGlyph>
    );
  }
  return (
    <StatusGlyph status={status}>
      <AppIcon icon="circle" size={14} />
    </StatusGlyph>
  );
}

function isLiveFeedStatus(status: FeedStatus): boolean {
  return status === "running" || status === "cancelling";
}

function isLiveRun(run: Pick<RunRecord, "status">): boolean {
  return run.status === "running" || run.status === "cancelling";
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
  if (hasVisibleRunFeedback(run, { includeWorkflowTrace: true })) return headline;
  return {
    id: "live-waiting",
    kind: "trace",
    status: "running",
    title: frontendMessage("chat.activity.thinking"),
  };
}

function isGenericWaitingHeadline(headline: FeedItem): boolean {
  return headline.id === "live" || headline.id === "live-waiting";
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

function PendingLine({ label }: { label: string }): JSX.Element {
  return (
    <StableActivitySlot stateKey="execution-pending">
      <div
        className="execution-feed-headline execution-feed-headline--pending max-w-full text-content-secondary"
        role="status"
        aria-live="polite"
        data-activity-feed-row
      >
        <span className="execution-feed-headline__icon text-content-muted" aria-hidden="true">
          <ActivityLoader size={16} active data-execution-status-icon="running" />
        </span>
        <span className="execution-feed-headline__title truncate">{label}</span>
      </div>
    </StableActivitySlot>
  );
}
