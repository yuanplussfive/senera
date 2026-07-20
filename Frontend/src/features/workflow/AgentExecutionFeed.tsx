import { useEffect, useMemo, useState, type AriaRole, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ChevronRight, GitBranch, Loader2, Workflow, Wrench, X } from "lucide-react";
import { cn } from "../../lib/util";
import { type RunRecord } from "../../store/sessionStore";
import { deriveFeedModel, statusTextClass, type FeedGroup, type FeedItem } from "./feedModel";
import { motionTimings, readFeedItemVariants, useMotionLevel, type MotionLevel } from "../../shared/motion";

export function AgentExecutionFeed({ run }: { run: RunRecord }): JSX.Element {
  const model = useMemo(() => deriveFeedModel(run), [run]);
  const groupSignature = useMemo(
    () => model.groups.map((group) => `${group.id}:${group.items.length}:${group.defaultExpanded ? 1 : 0}`).join("|"),
    [model.groups],
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;

  useEffect(() => {
    setExpandedGroups((current) => {
      const next: Record<string, boolean> = {};
      for (const group of model.groups) {
        if (!group.collapsible) continue;
        next[group.id] = current[group.id] ?? group.defaultExpanded ?? true;
      }
      return next;
    });
  }, [run.requestId, groupSignature, model.groups]);

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <FeedHeadline item={model.headline} stepCount={run.steps.length} />
      <div className="ml-6 overflow-hidden rounded-xl border border-line-subtle bg-surface-raised shadow-panel">
        {model.groups.map((group) =>
          group.collapsible ? (
            <FeedGroupBlock
              key={group.id}
              group={group}
              expanded={expandedGroups[group.id] ?? group.defaultExpanded ?? true}
              onToggle={() =>
                setExpandedGroups((current) => ({
                  ...current,
                  [group.id]: !(current[group.id] ?? group.defaultExpanded ?? true),
                }))
              }
              motionLevel={effectiveLevel}
            />
          ) : (
            <div key={group.id} className="flex flex-col">
              <AnimatePresence initial={false}>
                {group.items.map((item) => (
                  <FeedRow key={item.id} item={item} motionLevel={effectiveLevel} />
                ))}
              </AnimatePresence>
            </div>
          ),
        )}
      </div>
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
        {model.footer ? (
          <FeedMotionBlock motionLevel={effectiveLevel} className="pt-1.5 font-mono text-[10.5px] text-content-muted">
            {model.footer}
          </FeedMotionBlock>
        ) : null}
      </div>
    </div>
  );
}

function FeedHeadline({ item, stepCount }: { item: FeedItem; stepCount: number }): JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <FeedStatusIcon status={item.status} className="mt-0.5" />
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
  const Icon = group.variant === "delegation" ? Workflow : group.variant === "tools" ? Wrench : GitBranch;

  return (
    <div className="flex flex-col gap-1.5 py-0.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-content-secondary" />
        <span className="min-w-0 flex-1 text-[12.75px] font-medium text-content-primary">{group.label}</span>
        {group.meta ? <span className="font-mono text-[10.5px] text-content-muted">{group.meta}</span> : null}
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-content-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-content-muted" />
        )}
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <FeedMotionBlock key="tools" motionLevel={motionLevel} className="flex flex-col divide-y divide-line-subtle">
            <AnimatePresence initial={false}>
              {group.items.map((item) => (
                <FeedRow key={item.id} item={item} compact motionLevel={motionLevel} />
              ))}
            </AnimatePresence>
          </FeedMotionBlock>
        ) : null}
      </AnimatePresence>
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
    <motion.div
      variants={readFeedItemVariants(motionLevel)}
      initial="hidden"
      animate="show"
      exit="exit"
      transition={motionLevel === "none" ? { duration: 0 } : motionTimings.base}
      className={cn("flex min-w-0 items-start gap-2 px-2.5 py-2", compact && "py-1.5")}
    >
      {item.kind === "tool" ? (
        <Wrench className="mt-[1px] h-3.5 w-3.5 shrink-0 text-content-muted" />
      ) : (
        <GitBranch className="mt-[1px] h-3.5 w-3.5 shrink-0 text-content-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.75px] text-content-primary">{item.title}</div>
        {item.subtitle ? (
          <div className="mt-0.5 truncate text-[11.5px] text-content-secondary">{item.subtitle}</div>
        ) : null}
      </div>
      {item.meta ? (
        <span className={cn("shrink-0 pt-px text-[11.5px]", statusTextClass(item.status))}>{item.meta}</span>
      ) : null}
    </motion.div>
  );
}

function FeedStatusIcon({ status, className }: { status: FeedItem["status"]; className?: string }): JSX.Element {
  if (status === "running")
    return <Loader2 className={cn("h-4 w-4 shrink-0 animate-spin text-umber-600", className)} />;
  if (status === "failed") return <X className={cn("h-4 w-4 shrink-0 text-brick-600", className)} />;
  return <Check className={cn("h-4 w-4 shrink-0 text-content-secondary", className)} />;
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
        className={cn("h-3.5 w-3.5 shrink-0 text-content-secondary", motionLevel !== "none" && "animate-spin")}
      />
      <span className="min-w-0 truncate">{label}</span>
    </FeedMotionBlock>
  );
}
