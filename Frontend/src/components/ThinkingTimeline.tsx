import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Virtuoso } from "react-virtuoso";
import {
  Lightbulb,
  Loader2,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock3,
  ListTree,
  Wrench,
} from "lucide-react";
import { useStore, type RunRecord } from "../store/sessionStore";
import { cn, formatDuration, formatTime } from "../lib/util";
import { Tooltip } from "./ui/Tooltip";
import { Dialog, DialogContent } from "./ui/Dialog";
import { summarizeRun, type RunSummary } from "./workflow/runSummary";
import { shouldLoadWorkflowCanvas } from "./workflow/canvasLoadPolicy";
import {
  motionSprings,
  motionTimings,
  readFocusPanelVariants,
  useMotionLevel,
} from "../shared/motion";

const LazyThinkingTimelineCanvas = lazy(() =>
  import("./ThinkingTimelineCanvas").then((module) => ({
    default: module.ThinkingTimelineCanvas,
  })),
);
const RUN_DRAWER_ROW_HEIGHT = 44;
const RUN_DRAWER_VERTICAL_PADDING = 12;
const RUN_DRAWER_MAX_HEIGHT = 224;

export function ThinkingTimeline({
  presentation = "auto",
  hidePanelTitle = false,
}: {
  presentation?: "auto" | "panel" | "rail";
  hidePanelTitle?: boolean;
}): JSX.Element {
  return <ThinkingPanel presentation={presentation} hidePanelTitle={hidePanelTitle} />;
}

function ThinkingPanel({
  presentation,
  hidePanelTitle,
}: {
  presentation: "auto" | "panel" | "rail";
  hidePanelTitle: boolean;
}): JSX.Element {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions[activeId] : null));
  const collapsed = useStore((s) => s.rightPanelCollapsed);
  const toggleCollapsed = useStore((s) => s.toggleRightPanel);
  const viewedRunId = useStore((s) =>
    activeId ? s.viewedRunIdBySession[activeId] : undefined,
  );
  const setViewedRun = useStore((s) => s.setViewedRun);
  const [focusOpen, setFocusOpen] = useState(false);

  const runs = session?.runs ?? [];
  const latestRun = runs[runs.length - 1];
  const selectedRun = useMemo(() => {
    if (!viewedRunId) return undefined;
    return runs.find((r) => r.requestId === viewedRunId);
  }, [runs, viewedRunId]);
  const isPinnedToHistory = !!selectedRun && selectedRun.requestId !== latestRun?.requestId;
  const run = isPinnedToHistory ? selectedRun : latestRun;

  useEffect(() => {
    if (!activeId) return;
    if (!viewedRunId) return;
    if (!selectedRun) {
      setViewedRun(activeId, undefined);
      return;
    }
    if (selectedRun.requestId === latestRun?.requestId) {
      setViewedRun(activeId, undefined);
    }
  }, [activeId, viewedRunId, selectedRun, latestRun?.requestId, setViewedRun]);

  const isRail = presentation === "rail" || (presentation === "auto" && collapsed);

  const toggleFocus = useCallback(() => {
    setFocusOpen((value) => !value);
  }, []);

  if (isRail) {
    return (
      <aside className="flex h-full w-[44px] shrink-0 flex-col items-center border-l border-ink-200/60 bg-paper-100/40 py-3">
        <Tooltip content="展开思考过程" side="left">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
            aria-label="expand"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        </Tooltip>
        <Lightbulb className="mt-2 h-4 w-4 text-terra-500" />
        {run ? (
          <div className="mt-2 rotate-180 font-mono text-[10px] uppercase tracking-wider text-ink-400" style={{ writingMode: "vertical-rl" }}>
            {run.steps.length} 步
          </div>
        ) : null}
      </aside>
    );
  }

  return (
    <>
      <aside className={cn(
        "flex h-full shrink-0 flex-col border-l border-ink-200/60 bg-paper-100/40",
        presentation === "panel" ? "w-full border-l-0" : "w-[460px]",
      )}>
        <TopBar
          run={run}
          runs={runs}
          currentRunId={run?.requestId}
          pinnedToHistory={isPinnedToHistory}
          focusOpen={focusOpen}
          hideTitle={hidePanelTitle}
          onSelect={(rid) => activeId && setViewedRun(activeId, rid)}
          onFollowLatest={() => activeId && setViewedRun(activeId, undefined)}
          onToggleFocus={toggleFocus}
          onCollapse={presentation === "panel" ? undefined : toggleCollapsed}
        />
        <CanvasArea run={run} />
      </aside>
      <TimelineFocusDialog
        open={focusOpen}
        run={run}
        runs={runs}
        currentRunId={run?.requestId}
        pinnedToHistory={isPinnedToHistory}
        onOpenChange={setFocusOpen}
        onSelect={(rid) => activeId && setViewedRun(activeId, rid)}
        onFollowLatest={() => activeId && setViewedRun(activeId, undefined)}
      />
    </>
  );
}

// ---------- 顶栏 ----------

function TopBar({
  run,
  runs,
  currentRunId,
  pinnedToHistory,
  focusOpen,
  hideTitle,
  onSelect,
  onFollowLatest,
  onToggleFocus,
  onCollapse,
}: {
  run?: RunRecord;
  runs: RunRecord[];
  currentRunId?: string;
  pinnedToHistory: boolean;
  focusOpen: boolean;
  hideTitle?: boolean;
  onSelect: (requestId: string) => void;
  onFollowLatest: () => void;
  onToggleFocus: () => void;
  onCollapse?: () => void;
}): JSX.Element {
  const summary = run ? summarizeRun(run) : undefined;

  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b border-ink-200/60 bg-paper-100/70 px-3">
        {onCollapse ? (
          <Tooltip content="收起思考过程" side="left">
            <button
              type="button"
              onClick={onCollapse}
              className="grid h-7 w-7 place-items-center rounded text-ink-500 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
              aria-label="collapse"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </Tooltip>
        ) : null}
        {hideTitle ? null : (
          <>
            <Lightbulb className="h-4 w-4 text-terra-500" />
            <span className="text-[13px] font-medium text-ink-800">思考过程</span>
          </>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div className="hidden min-w-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-400 sm:flex">
            {run ? (
              <span>
                {summary?.completed}/{summary?.total}
                {summary && summary.failed > 0 ? <span className="ml-1 text-brick-500">·{summary.failed} 失败</span> : null}
              </span>
            ) : null}
          </div>
          {pinnedToHistory ? (
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-ink-200/60 bg-paper-50/80 p-0.5 shadow-[0_1px_0_rgba(28,26,23,0.04)]">
            <button
              type="button"
              onClick={onFollowLatest}
              className="h-7 rounded px-2 text-[11.5px] font-medium text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70"
            >
              跟随最新
            </button>
          </div>
          ) : null}
          <Tooltip content="放大查看" side="bottom">
            <button
              type="button"
              onClick={onToggleFocus}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70"
              aria-pressed={focusOpen}
              aria-label="放大查看"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Run 选择器 */}
      {runs.length > 0 ? (
        <div className="border-b border-ink-200/40 bg-paper-50/70 px-3 py-2">
          {summary && run ? <RunSummaryStrip run={run} summary={summary} /> : null}
          <RunSelector
            runs={runs}
            currentRunId={currentRunId}
            onSelect={onSelect}
            pinnedToHistory={pinnedToHistory}
          />
        </div>
      ) : null}
    </>
  );
}

function RunSummaryStrip({
  run,
  summary,
}: {
  run: RunRecord;
  summary: RunSummary;
}): JSX.Element {
  return (
    <div className="mb-2 grid grid-cols-3 gap-1.5">
      <MetricChip
        icon={<ListTree className="h-3 w-3" />}
        label="节点"
        value={`${summary.completed}/${summary.total}`}
        tone={summary.failed > 0 ? "danger" : run.status === "running" ? "live" : "neutral"}
      />
      <MetricChip
        icon={<Wrench className="h-3 w-3" />}
        label="工具"
        value={`${summary.tools}`}
      />
      <MetricChip
        icon={<Clock3 className="h-3 w-3" />}
        label={summary.startedAt}
        value={summary.duration || "进行中"}
      />
    </div>
  );
}

function MetricChip({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  tone?: "neutral" | "live" | "danger";
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5",
        tone === "danger"
          ? "border-brick-100 bg-brick-50/70 text-brick-600"
          : tone === "live"
            ? "border-umber-200/60 bg-umber-50 text-umber-600"
            : "border-ink-200/60 bg-paper-100/70 text-ink-600",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate font-mono text-[10px] text-current/70">{label}</span>
      <span className="ml-auto shrink-0 font-mono text-[10.5px] font-medium">{value}</span>
    </div>
  );
}

function RunSelector({
  runs,
  currentRunId,
  onSelect,
  pinnedToHistory,
}: {
  runs: RunRecord[];
  currentRunId?: string;
  onSelect: (id: string) => void;
  pinnedToHistory: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const current = runs.find((r) => r.requestId === currentRunId) ?? runs[runs.length - 1];
  const currentIndex = Math.max(0, runs.findIndex((run) => run.requestId === current.requestId));
  const previousRun = currentIndex > 0 ? runs[currentIndex - 1] : undefined;
  const nextRun = currentIndex < runs.length - 1 ? runs[currentIndex + 1] : undefined;
  const newestRunId = runs[runs.length - 1]?.requestId;
  const drawerHeight = Math.min(
    runs.length * RUN_DRAWER_ROW_HEIGHT + RUN_DRAWER_VERTICAL_PADDING,
    RUN_DRAWER_MAX_HEIGHT,
  );
  const selectRun = useCallback((runId: string) => {
    onSelect(runId);
    setOpen(false);
  }, [onSelect]);

  return (
    <div className="relative z-20 rounded-lg border border-ink-200/60 bg-paper-100/70">
      <div className="flex min-w-0 items-stretch">
        <RunNavButton
          label="上一轮"
          disabled={!previousRun}
          onClick={() => previousRun && onSelect(previousRun.requestId)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </RunNavButton>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "group flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left transition hover:bg-paper-50/80",
            open && "bg-paper-50/80",
          )}
          aria-expanded={open}
        >
          <RunStatusDot status={current.status} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
              <span className="shrink-0 text-ink-500">
                {runs.length === 1
                  ? "唯一一轮"
                  : !pinnedToHistory && current.requestId === newestRunId
                    ? "最新一轮"
                    : `第 ${currentIndex + 1} 轮`}
              </span>
              <span className="shrink-0">· {formatTime(current.startedAt)}</span>
              <span className="shrink-0">· {formatDuration(current.startedAt, current.endedAt) || "进行中"}</span>
            </div>
            <div className="mt-0.5 truncate text-[12.5px] leading-5 text-ink-850">
              {current.input || "无输入"}
            </div>
          </div>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-ink-400 transition group-hover:text-ink-700",
              open && "rotate-180",
            )}
          />
        </button>

        <RunNavButton
          label="下一轮"
          disabled={!nextRun}
          onClick={() => nextRun && onSelect(nextRun.requestId)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </RunNavButton>
      </div>

      <div
        className={cn(
          "absolute left-[-1px] right-[-1px] top-full z-30 origin-top overflow-hidden rounded-b-lg border-x border-b border-ink-200/60 bg-paper-50 shadow-soft transition-[opacity,transform,visibility] duration-150 ease-out will-change-transform",
          open
            ? "visible translate-y-0 scale-y-100 opacity-100"
            : "invisible pointer-events-none -translate-y-1 scale-y-[0.98] opacity-0",
        )}
      >
        <div className="border-t border-ink-200/50 p-1.5">
          {open ? (
            <Virtuoso
              className="scrollbar-thin"
              data={runs}
              style={{ height: drawerHeight }}
              initialTopMostItemIndex={currentIndex}
              computeItemKey={(_index, run) => run.requestId}
              itemContent={(index, run) => (
                <div className="pb-1">
                  <RunDrawerItem
                    run={run}
                    index={index}
                    latest={run.requestId === newestRunId}
                    selected={run.requestId === current.requestId}
                    onSelect={() => selectRun(run.requestId)}
                  />
                </div>
              )}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RunDrawerItem({
  run,
  index,
  latest,
  selected,
  onSelect,
}: {
  run: RunRecord;
  index: number;
  latest: boolean;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition",
        selected
          ? "bg-ink-900 text-paper-50 shadow-sm"
          : "text-ink-650 hover:bg-ink-900/[0.045] hover:text-ink-900",
      )}
      aria-current={selected ? "true" : undefined}
    >
      <RunStatusDot status={run.status} active={selected} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("font-mono text-[10px]", selected ? "text-paper-50/70" : "text-ink-400")}>
            {latest ? "最新" : `#${index + 1}`}
          </span>
          <span className="truncate text-[12.5px] leading-5">
            {run.input || "无输入"}
          </span>
        </div>
        <div className={cn("mt-0.5 font-mono text-[10px]", selected ? "text-paper-50/55" : "text-ink-400")}>
          {formatTime(run.startedAt)} · {formatDuration(run.startedAt, run.endedAt) || "进行中"}
        </div>
      </div>
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-paper-50/70" /> : null}
    </button>
  );
}

function RunNavButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: JSX.Element;
  label: string;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "grid w-8 shrink-0 place-items-center text-ink-500 transition",
          disabled
            ? "cursor-not-allowed opacity-35"
            : "hover:bg-ink-900/[0.05] hover:text-ink-900",
        )}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function RunStatusDot({
  status,
  active,
}: {
  status: RunRecord["status"];
  active?: boolean;
}): JSX.Element {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        status === "running"
          ? "bg-terra-500"
          : status === "failed"
            ? "bg-brick-500"
            : status === "cancelled"
              ? "bg-ink-400"
              : "bg-moss-500",
        active && "ring-2 ring-paper-50/40",
      )}
    />
  );
}

function TimelineFocusDialog({
  open,
  run,
  runs,
  currentRunId,
  pinnedToHistory,
  onOpenChange,
  onSelect,
  onFollowLatest,
}: {
  open: boolean;
  run?: RunRecord;
  runs: RunRecord[];
  currentRunId?: string;
  pinnedToHistory: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (requestId: string) => void;
  onFollowLatest: () => void;
}): JSX.Element {
  const summary = run ? summarizeRun(run) : undefined;
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="思考过程"
        description={summary ? `${summary.completed}/${summary.total} 节点 · ${summary.tools} 工具` : undefined}
        placement="inset"
        motionPreset="focus"
        frameClassName="bottom-3 left-3 right-3 top-3 sm:bottom-4 sm:left-4 sm:right-4 sm:top-4"
        className="h-auto max-h-none w-auto max-w-none rounded-lg"
        bodyClassName="flex min-h-0 flex-1 flex-col bg-paper-100/40"
      >
        <motion.div
          variants={readFocusPanelVariants(effectiveLevel)}
          initial="hidden"
          animate="show"
          exit="exit"
          transition={disableMotion ? { duration: 0 } : reduceMotion ? motionTimings.base : motionSprings.soft}
          className="min-h-0 flex flex-1 flex-col"
        >
          {runs.length > 0 ? (
            <div className="shrink-0 border-b border-ink-200/40 bg-paper-50/70 px-3 py-2 sm:px-4">
              {summary && run ? <RunSummaryStrip run={run} summary={summary} /> : null}
              <RunSelector
                runs={runs}
                currentRunId={currentRunId}
                onSelect={onSelect}
                pinnedToHistory={pinnedToHistory}
              />
              {pinnedToHistory ? (
                <button
                  type="button"
                  onClick={onFollowLatest}
                  className="mt-2 h-8 rounded-md px-2.5 text-[12px] font-medium text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70"
                >
                  跟随最新
                </button>
              ) : null}
            </div>
          ) : null}
          <CanvasArea run={run} focusVersion={open ? 1 : 0} />
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- 画布 ----------

function CanvasArea({
  run,
  focusVersion = 0,
}: {
  run?: RunRecord;
  focusVersion?: number;
}): JSX.Element {
  if (!shouldLoadWorkflowCanvas(run)) {
    return (
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <EmptyCanvas />
      </div>
    );
  }

  return (
    <Suspense fallback={<CanvasLoading />}>
      <LazyThinkingTimelineCanvas run={run} focusVersion={focusVersion} />
    </Suspense>
  );
}

function CanvasLoading(): JSX.Element {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden">
      <div className="inline-flex items-center gap-2 rounded-md border border-ink-200/60 bg-paper-50/80 px-3 py-2 text-[12px] text-ink-500 shadow-bubble-ai">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-umber-500" />
        加载执行图
      </div>
    </div>
  );
}

function EmptyCanvas(): JSX.Element {
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
  return (
    <motion.div
      variants={readFocusPanelVariants(effectiveLevel)}
      initial="hidden"
      animate="show"
      transition={disableMotion ? { duration: 0 } : reduceMotion ? motionTimings.base : motionSprings.soft}
      className="flex max-w-[320px] flex-col items-center px-6 text-center"
    >
      <div className="grid h-11 w-11 place-items-center rounded-xl border border-ink-200/70 bg-paper-50 shadow-[0_1px_2px_rgba(28,26,23,0.04)]">
        <ListTree className="h-5 w-5 text-ink-500" />
      </div>
      <p className="mt-3 text-[13px] font-medium text-ink-850">
        执行图示
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
        这里会汇总理解、模型决策、工具调用和最终回复。
      </p>
      <div className="mt-3 grid w-full grid-cols-2 gap-1.5 text-left">
        <EmptyHint icon={<ListTree className="h-3 w-3" />} label="节点详情" />
        <EmptyHint icon={<Wrench className="h-3 w-3" />} label="工具链路" />
        <EmptyHint icon={<Maximize2 className="h-3 w-3" />} label="放大查看" />
        <EmptyHint icon={<Clock3 className="h-3 w-3" />} label="耗时统计" />
      </div>
      <p className="mt-3 text-[11px] text-ink-400">
        可拖拽节点，滚轮平移，Ctrl+滚轮缩放。
      </p>
    </motion.div>
  );
}

function EmptyHint({ icon, label }: { icon: JSX.Element; label: string }): JSX.Element {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-ink-200/60 bg-paper-50/70 px-2 py-1.5 text-[11.5px] text-ink-600">
      <span className="shrink-0 text-ink-400">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
  );
}
