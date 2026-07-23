import { useId, useMemo, useState, type AriaRole, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ChevronRight, Circle, Loader2, X } from "lucide-react";
import { cn } from "../../lib/util";
import { type RunRecord } from "../../store/sessionStore";
import { deriveFeedModel, statusTextClass, type FeedGroup, type FeedItem } from "./feedModel";
import { FeedGroupIconCatalog, FeedItemIconCatalog } from "./feedPresentation";
import { motionTimings, readFeedItemVariants, useMotionLevel, type MotionLevel } from "../../shared/motion";

export function AgentExecutionFeed({ run, showBody = true }: { run: RunRecord; showBody?: boolean }): JSX.Element {
  const model = useMemo(() => deriveFeedModel(run), [run]);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
  const hasTimeline = model.groups.some((group) => group.items.length > 0);

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-execution-feed>
      <div className="relative min-w-0" data-execution-timeline>
        {hasTimeline ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-[7.5px] top-4 w-px bg-line-subtle"
            data-execution-rail
          />
        ) : null}
        <FeedHeadline item={model.headline} stepCount={run.steps.length} motionLevel={effectiveLevel} />
        {hasTimeline ? (
          <div className="mt-2.5 flex min-w-0 flex-col gap-1.5" role="list" aria-label={model.headline.title}>
            {model.groups.map((group) => (
              <FeedTimelineGroup
                key={group.id}
                group={group}
                expanded={expandedGroups.has(group.id)}
                onToggle={() => setExpandedGroups((current) => toggleSetEntry(current, group.id))}
                motionLevel={effectiveLevel}
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

function FeedTimelineGroup({
  group,
  expanded,
  onToggle,
  motionLevel,
}: {
  group: FeedGroup;
  expanded: boolean;
  onToggle: () => void;
  motionLevel: MotionLevel;
}): JSX.Element {
  if (group.variant === "trace" && !group.collapsible) {
    return (
      <>
        {group.items.map((item) => (
          <TimelineFeedItem key={item.id} item={item} />
        ))}
      </>
    );
  }

  if (group.collapsible) {
    return <FeedGroupBlock group={group} expanded={expanded} onToggle={onToggle} motionLevel={motionLevel} />;
  }

  return <FeedGroupRows group={group} motionLevel={motionLevel} />;
}

function FeedGroupRows({ group, motionLevel }: { group: FeedGroup; motionLevel: MotionLevel }): JSX.Element {
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
            <span className="shrink-0 font-mono text-[10.5px] text-content-muted">{group.meta}</span>
          ) : null}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-col" role="list">
          {group.items.map((item) => (
            <FeedRow key={item.id} item={item} compact motionLevel={motionLevel} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeedHeadline({
  item,
  stepCount,
  motionLevel,
}: {
  item: FeedItem;
  stepCount: number;
  motionLevel: MotionLevel;
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <TimelineMarker status={item.status} emphasis>
        <FeedStatusIcon status={item.status} motionLevel={motionLevel} />
      </TimelineMarker>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium text-content-primary">{item.title}</span>
          <span className="text-[10.5px] tabular-nums text-content-muted">{stepCount} steps</span>
          {item.meta ? <span className="text-[10.5px] tabular-nums text-content-muted">{item.meta}</span> : null}
        </div>
        {item.subtitle ? (
          <div className="mt-0.5 text-[12px] leading-relaxed text-content-secondary">{item.subtitle}</div>
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
}: {
  group: FeedGroup;
  expanded: boolean;
  onToggle: () => void;
  motionLevel: MotionLevel;
}): JSX.Element {
  const variant = group.variant ?? "trace";
  const Icon = FeedGroupIconCatalog[variant];
  const contentId = useId();

  return (
    <div className="relative flex min-w-0 items-start gap-2.5" role="listitem" data-feed-group-variant={variant}>
      <TimelineMarker status={summarizeGroupStatus(group)}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </TimelineMarker>
      <div className="min-w-0 flex-1 pb-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          data-feed-group={group.id}
          className="group -mx-1 flex min-h-7 w-[calc(100%+0.5rem)] min-w-0 items-center gap-2 rounded-md px-1 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
        >
          <span className="min-w-0 flex-1 text-[12.75px] font-medium text-content-primary">{group.label}</span>
          {group.meta ? (
            <span className="shrink-0 font-mono text-[10.5px] text-content-muted">{group.meta}</span>
          ) : null}
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-content-muted" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-content-muted" aria-hidden="true" />
          )}
        </button>
        <AnimatePresence initial={false}>
          {expanded ? (
            <FeedMotionBlock key="details" motionLevel={motionLevel}>
              <div
                id={contentId}
                className="mt-1.5 flex min-w-0 flex-col rounded-md border border-line-subtle bg-surface-subtle/70 px-2 py-1"
                role="list"
                data-feed-detail-surface
              >
                {group.items.map((item) => (
                  <FeedRow key={item.id} item={item} compact motionLevel={motionLevel} />
                ))}
              </div>
            </FeedMotionBlock>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function TimelineFeedItem({ item }: { item: FeedItem }): JSX.Element {
  const Icon = FeedItemIconCatalog[item.kind];

  return (
    <div className="relative flex min-w-0 items-start gap-2.5" role="listitem" data-feed-item-kind={item.kind}>
      <TimelineMarker status={item.status}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </TimelineMarker>
      <FeedItemContent
        item={item}
        className={cn(
          "min-h-5 pb-1",
          item.status === "failed" && "-mt-1 rounded-md border border-brick-200 bg-brick-50 px-2 py-1.5",
        )}
      />
    </div>
  );
}

function FeedRow({
  item,
  compact = false,
  motionLevel,
}: {
  item: FeedItem;
  compact?: boolean;
  motionLevel: MotionLevel;
}): JSX.Element {
  return (
    <div
      className={cn("flex min-w-0 items-start gap-2 py-1.5", compact && "py-1")}
      role="listitem"
      data-feed-item-kind={item.kind}
    >
      <FeedRowStatus status={item.status} motionLevel={motionLevel} />
      <FeedItemContent item={item} />
    </div>
  );
}

function FeedItemContent({ item, className }: { item: FeedItem; className?: string }): JSX.Element {
  return (
    <div className={cn("flex min-w-0 flex-1 items-start gap-2", className)}>
      <div className="min-w-0 flex-1">
        <div className="break-words text-[12.75px] leading-5 text-content-primary">{item.title}</div>
        {item.subtitle ? (
          <div className="mt-0.5 break-words text-[11.5px] leading-[1.45] text-content-secondary">{item.subtitle}</div>
        ) : null}
      </div>
      {item.meta ? (
        <span className={cn("shrink-0 pt-px text-[11px] leading-5", statusTextClass(item.status))}>{item.meta}</span>
      ) : null}
    </div>
  );
}

function TimelineMarker({
  status,
  emphasis = false,
  children,
}: {
  status: FeedItem["status"];
  emphasis?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-canvas text-content-muted ring-[3px] ring-surface-canvas",
        statusTextClass(status),
        emphasis && "mt-0.5",
      )}
      data-feed-marker-status={status}
    >
      {children}
    </span>
  );
}

function FeedRowStatus({ status, motionLevel }: { status: FeedItem["status"]; motionLevel: MotionLevel }): JSX.Element {
  const iconClassName = cn("mt-1 h-3 w-3 shrink-0", statusTextClass(status));
  if (status === "running") {
    return <Loader2 className={cn(iconClassName, motionLevel === "full" && "animate-spin")} aria-hidden="true" />;
  }
  if (status === "failed") return <X className={iconClassName} aria-hidden="true" />;
  if (status === "done") return <Check className={iconClassName} aria-hidden="true" />;
  return <Circle className={cn(iconClassName, "h-2.5 w-2.5")} aria-hidden="true" />;
}

function summarizeGroupStatus(group: FeedGroup): FeedItem["status"] {
  if (group.items.some((item) => item.status === "failed")) return "failed";
  if (group.items.some((item) => item.status === "running")) return "running";
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

function FeedStatusIcon({
  status,
  motionLevel,
  className,
}: {
  status: FeedItem["status"];
  motionLevel: MotionLevel;
  className?: string;
}): JSX.Element {
  if (status === "running")
    return (
      <Loader2
        className={cn("h-4 w-4 shrink-0", motionLevel === "full" && "animate-spin", statusTextClass(status), className)}
      />
    );
  if (status === "failed") return <X className={cn("h-4 w-4 shrink-0", statusTextClass(status), className)} />;
  if (status === "pending" || status === "neutral") {
    return <Circle className={cn("h-3 w-3 shrink-0", statusTextClass(status), className)} />;
  }
  return <Check className={cn("h-4 w-4 shrink-0", statusTextClass(status), className)} />;
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
      <Loader2
        className={cn("h-3.5 w-3.5 shrink-0 text-content-secondary", motionLevel === "full" && "animate-spin")}
      />
      <span className="min-w-0 truncate">{label}</span>
    </FeedMotionBlock>
  );
}
