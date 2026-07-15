import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Maximize2, PanelRightClose, PanelRightOpen, ListTree } from "lucide-react";
import { useStore, type RunRecord } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Dialog, DialogContent, IconButton, MetaLabel } from "../../shared/ui";
import { summarizeRun } from "./runSummary";
import { shouldLoadWorkflowCanvas } from "./canvasLoadPolicy";
import { RunSelector, RunSummaryStrip } from "./WorkflowRunControls";
import { motionSprings, motionTimings, readFocusPanelVariants, useMotionLevel } from "../../shared/motion";

const LazyThinkingTimelineCanvas = lazy(() =>
  import("./ThinkingTimelineCanvas").then((module) => ({
    default: module.ThinkingTimelineCanvas,
  })),
);

export function ThinkingTimeline({
  presentation = "auto",
  hidePanelTitle = false,
}: {
  presentation?: "auto" | "panel" | "dock";
  hidePanelTitle?: boolean;
}): JSX.Element {
  if (presentation === "dock") return <WorkflowDock />;
  return <ThinkingPanel presentation={presentation} hidePanelTitle={hidePanelTitle} />;
}

function WorkflowDock(): JSX.Element {
  const collapsed = useStore((state) => state.rightPanelCollapsed);
  const setCollapsed = useStore((state) => state.setRightPanelCollapsed);
  const toggleCollapsed = useStore((state) => state.toggleRightPanel);

  return (
    <nav
      className="flex h-full w-[46px] flex-col items-center border-l border-ink-200/70 bg-[var(--theme-sidebar-bg)] px-1.5 py-2"
      aria-label={frontendMessage("workflow.panel.title")}
      data-workflow-dock
    >
      <IconButton
        label={frontendMessage("workflow.panel.title")}
        tooltip={frontendMessage("workflow.panel.title")}
        tooltipSide="left"
        aria-pressed={!collapsed}
        onClick={() => setCollapsed(false)}
        className={cn(
          "h-8 w-8 rounded-md transition-colors duration-150",
          !collapsed
            ? "bg-terra-50 text-terra-700 ring-1 ring-inset ring-terra-200/80"
            : "text-ink-500 hover:bg-ink-900/[0.045] hover:text-ink-800",
        )}
      >
        <ListTree className="h-4 w-4" />
      </IconButton>

      <div className="mt-auto">
        <IconButton
          label={collapsed ? frontendMessage("workflow.panel.expand") : frontendMessage("workflow.panel.collapse")}
          tooltip={collapsed ? frontendMessage("workflow.panel.expand") : frontendMessage("workflow.panel.collapse")}
          tooltipSide="left"
          onClick={toggleCollapsed}
          className="h-8 w-8 text-ink-500"
        >
          {collapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
        </IconButton>
      </div>
    </nav>
  );
}

function ThinkingPanel({
  presentation,
  hidePanelTitle,
}: {
  presentation: "auto" | "panel";
  hidePanelTitle: boolean;
}): JSX.Element {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions[activeId] : null));
  const toggleCollapsed = useStore((s) => s.toggleRightPanel);
  const viewedRunId = useStore((s) => (activeId ? s.viewedRunIdBySession[activeId] : undefined));
  const setViewedRun = useStore((s) => s.setViewedRun);
  const [focusOpen, setFocusOpen] = useState(false);

  const runs = useMemo(() => session?.runs ?? [], [session?.runs]);
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

  const toggleFocus = useCallback(() => {
    setFocusOpen((value) => !value);
  }, []);

  return (
    <>
      <aside
        className={cn(
          "flex h-full shrink-0 flex-col border-l border-ink-200/70 bg-[var(--theme-elevated-bg)]",
          presentation === "panel" ? "w-full border-l-0" : "w-full",
        )}
      >
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
      <div className="flex h-[52px] items-center gap-2 border-b border-ink-200/70 bg-[var(--theme-elevated-bg)] px-3">
        {onCollapse ? (
          <IconButton
            label={frontendMessage("workflow.panel.collapse")}
            tooltip={frontendMessage("workflow.panel.collapse")}
            tooltipSide="left"
            size="sm"
            className="h-7 w-7 text-ink-500"
            onClick={onCollapse}
          >
            <PanelRightClose className="h-4 w-4" />
          </IconButton>
        ) : null}
        {hideTitle ? null : (
          <>
            <ListTree className="h-4 w-4 text-terra-600" />
            <span className="text-[13px] font-medium text-ink-800">{frontendMessage("workflow.panel.title")}</span>
          </>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <MetaLabel as="div" size="sm" className="hidden min-w-0 items-center gap-1.5 sm:flex">
            {run ? (
              <span>
                {summary?.completed}/{summary?.total}
                {summary && summary.failed > 0 ? (
                  <span className="ml-1 text-brick-500">
                    ·{summary.failed} {frontendMessage("runtime.migrated.features.workflow.ThinkingTimeline.196.106")}
                  </span>
                ) : null}
              </span>
            ) : null}
          </MetaLabel>
          {pinnedToHistory ? (
            <div className="flex shrink-0 items-center gap-1 rounded-md border border-ink-200/60 bg-paper-50/80 p-0.5 shadow-[var(--shadow-bubble-user)]">
              <button
                type="button"
                onClick={onFollowLatest}
                className="h-7 rounded px-2 text-[11.5px] font-medium text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70"
              >
                {frontendMessage("workflow.panel.followLatest")}
              </button>
            </div>
          ) : null}
          <IconButton
            label={frontendMessage("workflow.panel.focus")}
            tooltip={frontendMessage("workflow.panel.focus")}
            tooltipSide="bottom"
            aria-pressed={focusOpen}
            onClick={onToggleFocus}
          >
            <Maximize2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {/* Run 选择器 */}
      {runs.length > 0 ? (
        <div className="border-b border-ink-200/40 bg-paper-50/70 px-3 py-2">
          {summary && run ? <RunSummaryStrip run={run} summary={summary} /> : null}
          <RunSelector runs={runs} currentRunId={currentRunId} onSelect={onSelect} pinnedToHistory={pinnedToHistory} />
        </div>
      ) : null}
    </>
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
        title={frontendMessage("workflow.panel.title")}
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
                  {frontendMessage("workflow.panel.followLatest")}
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

function CanvasArea({ run, focusVersion = 0 }: { run?: RunRecord; focusVersion?: number }): JSX.Element {
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
        {frontendMessage("workflow.panel.loadingGraph")}
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
      <ListTree className="h-5 w-5 text-ink-350" />
      <p className="mt-4 text-[13px] font-semibold text-ink-800">{frontendMessage("workflow.panel.emptyTitle")}</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
        {frontendMessage("workflow.panel.emptyDescription")}
      </p>
    </motion.div>
  );
}
