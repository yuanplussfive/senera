import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/util";
import { ListTree, Loader2, Maximize2, PanelRightClose } from "lucide-react";
import { useStore, type RunRecord } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Dialog, DialogContent, IconButton } from "../../shared/ui";
import { summarizeRun } from "./runSummary";
import { shouldLoadWorkflowCanvas } from "./canvasLoadPolicy";
import { RunSelector, RunSummaryStrip } from "./WorkflowRunControls";
import { motionSprings, motionTimings, readFocusPanelVariants, useMotionLevel } from "../../shared/motion";

export type ThinkingTimelineDockTab = {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
};

const LazyThinkingTimelineCanvas = lazy(() =>
  import("./ThinkingTimelineCanvas").then((module) => ({
    default: module.ThinkingTimelineCanvas,
  })),
);

export function ThinkingTimeline({
  presentation = "auto",
  hidePanelTitle = false,
  dockTabs,
  onClosePanel,
}: {
  presentation?: "auto" | "dock" | "panel";
  hidePanelTitle?: boolean;
  dockTabs?: readonly ThinkingTimelineDockTab[];
  onClosePanel?: () => void;
}): JSX.Element {
  return (
    <ThinkingPanel
      presentation={presentation}
      hidePanelTitle={hidePanelTitle}
      dockTabs={dockTabs}
      onClosePanel={onClosePanel}
    />
  );
}

function ThinkingPanel({
  presentation,
  hidePanelTitle,
  dockTabs,
  onClosePanel,
}: {
  presentation: "auto" | "dock" | "panel";
  hidePanelTitle: boolean;
  dockTabs?: readonly ThinkingTimelineDockTab[];
  onClosePanel?: () => void;
}): JSX.Element {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions[activeId] : null));
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
          "flex h-full w-full shrink-0 flex-col",
          presentation === "dock" ? "bg-transparent" : "bg-surface-raised",
        )}
        data-ui-chrome
        data-panel-presentation={presentation}
      >
        <TopBar
          run={run}
          runs={runs}
          currentRunId={run?.requestId}
          pinnedToHistory={isPinnedToHistory}
          hideTitle={hidePanelTitle}
          presentation={presentation}
          dockTabs={dockTabs}
          onSelect={(rid) => activeId && setViewedRun(activeId, rid)}
          onFollowLatest={() => activeId && setViewedRun(activeId, undefined)}
          onClosePanel={onClosePanel}
        />
        <CanvasArea run={run} focusOpen={focusOpen} onToggleFocus={toggleFocus} />
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
  hideTitle,
  presentation,
  dockTabs,
  onSelect,
  onFollowLatest,
  onClosePanel,
}: {
  run?: RunRecord;
  runs: RunRecord[];
  currentRunId?: string;
  pinnedToHistory: boolean;
  hideTitle?: boolean;
  presentation: "auto" | "dock" | "panel";
  dockTabs?: readonly ThinkingTimelineDockTab[];
  onSelect: (requestId: string) => void;
  onFollowLatest: () => void;
  onClosePanel?: () => void;
}): JSX.Element {
  const summary = run ? summarizeRun(run) : undefined;

  return (
    <>
      <div
        className={cn(
          "relative z-10 flex items-center gap-2 border-b border-line-subtle",
          presentation === "dock" ? "h-[58px] bg-transparent px-3 pr-12" : "h-[52px] bg-surface-raised px-3",
        )}
        data-window-drag-region
      >
        {dockTabs ? (
          <nav
            className="flex min-w-0 flex-1 items-center gap-0.5 rounded-full border border-line-subtle bg-surface-subtle p-1"
            aria-label={frontendMessage("workflow.dock.tabs")}
            data-workflow-dock-tabs
          >
            {dockTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.active}
                onClick={tab.onSelect}
                className={cn(
                  "min-w-0 flex-1 rounded-full px-1.5 py-1.5 text-[12px] font-medium text-content-muted transition-[background-color,color,box-shadow] duration-150 hover:text-content-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                  tab.active && "bg-surface-raised text-content-primary shadow-sm",
                  !tab.active && "hover:bg-surface-hover",
                )}
                data-workflow-dock-tab={tab.id}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        ) : hideTitle ? null : (
          <nav
            className="flex min-w-0 items-center gap-2"
            aria-label={frontendMessage("workflow.panel.title")}
            data-workspace-tool-dock
          >
            <ListTree className="h-4 w-4 shrink-0 text-content-secondary" />
            <span className="truncate text-[13px] font-medium text-content-primary">
              {frontendMessage("workflow.panel.title")}
            </span>
          </nav>
        )}
        {onClosePanel ? (
          <div className="ml-auto">
            <IconButton
              label={frontendMessage("workflow.panel.collapse")}
              tone="muted"
              tooltip={frontendMessage("workflow.panel.collapse")}
              tooltipSide="bottom"
              onClick={onClosePanel}
            >
              <PanelRightClose className="h-4 w-4" />
            </IconButton>
          </div>
        ) : null}
      </div>

      {runs.length > 0 ? (
        <div
          className={cn(
            "shrink-0",
            presentation === "dock"
              ? "mx-3 mt-3 rounded-[14px] border border-line-subtle bg-surface-raised px-3 py-2.5 shadow-[var(--theme-node-shadow)]"
              : "border-b border-line-subtle bg-surface-subtle/45 px-3 py-2",
          )}
          data-workflow-run-summary
        >
          <RunSelector runs={runs} currentRunId={currentRunId} onSelect={onSelect} pinnedToHistory={pinnedToHistory} />
          <div className="mt-1 flex min-w-0 items-center justify-between gap-2 px-1">
            {summary && run ? <RunSummaryStrip run={run} summary={summary} /> : null}
            {pinnedToHistory ? (
              <button
                type="button"
                onClick={onFollowLatest}
                className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-content-secondary transition hover:bg-surface-hover hover:text-content-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
              >
                {frontendMessage("workflow.panel.followLatest")}
              </button>
            ) : null}
          </div>
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
        description={
          summary
            ? frontendMessage("workflow.summary.nodesAndTools", {
                completed: summary.completed,
                total: summary.total,
                tools: summary.tools,
              })
            : undefined
        }
        placement="inset"
        motionPreset="focus"
        frameClassName="bottom-3 left-3 right-3 top-3 sm:bottom-4 sm:left-4 sm:right-4 sm:top-4"
        className="h-auto max-h-none w-auto max-w-none rounded-lg"
        bodyClassName="flex min-h-0 flex-1 flex-col bg-surface-subtle"
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
            <div className="shrink-0 border-b border-line-subtle bg-surface-subtle/45 px-3 py-2 sm:px-4">
              <RunSelector
                runs={runs}
                currentRunId={currentRunId}
                onSelect={onSelect}
                pinnedToHistory={pinnedToHistory}
              />
              <div className="mt-1 flex min-w-0 items-center justify-between gap-2 px-1">
                {summary && run ? <RunSummaryStrip run={run} summary={summary} /> : null}
                {pinnedToHistory ? (
                  <button
                    type="button"
                    onClick={onFollowLatest}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-content-secondary transition hover:bg-surface-hover hover:text-content-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
                  >
                    {frontendMessage("workflow.panel.followLatest")}
                  </button>
                ) : null}
              </div>
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
  focusOpen = false,
  onToggleFocus,
}: {
  run?: RunRecord;
  focusVersion?: number;
  focusOpen?: boolean;
  onToggleFocus?: () => void;
}): JSX.Element {
  if (!shouldLoadWorkflowCanvas(run)) {
    return (
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden bg-transparent"
        data-workflow-execution-content
      >
        <CanvasFocusAction focusOpen={focusOpen} onToggleFocus={onToggleFocus} />
        <EmptyCanvas />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-transparent" data-workflow-execution-content>
      <CanvasFocusAction focusOpen={focusOpen} onToggleFocus={onToggleFocus} />
      <Suspense fallback={<CanvasLoading />}>
        <LazyThinkingTimelineCanvas run={run} focusVersion={focusVersion} />
      </Suspense>
    </div>
  );
}

function CanvasFocusAction({
  focusOpen,
  onToggleFocus,
}: {
  focusOpen: boolean;
  onToggleFocus?: () => void;
}): JSX.Element | null {
  if (!onToggleFocus) return null;
  return (
    <IconButton
      label={frontendMessage("workflow.panel.focus")}
      tone="muted"
      tooltip={frontendMessage("workflow.panel.focus")}
      tooltipSide="left"
      aria-pressed={focusOpen}
      onClick={onToggleFocus}
      className="absolute right-3 top-3 z-20 border border-line-subtle bg-surface-raised shadow-sm"
      data-workflow-focus-action
    >
      <Maximize2 className="h-4 w-4" />
    </IconButton>
  );
}

function CanvasLoading(): JSX.Element {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-transparent">
      <div className="inline-flex items-center gap-2 text-[12px] text-content-secondary">
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
      <ListTree className="h-5 w-5 text-content-muted" />
      <p className="mt-4 text-[13px] font-semibold text-content-primary">
        {frontendMessage("workflow.panel.emptyTitle")}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-content-secondary">
        {frontendMessage("workflow.panel.emptyDescription")}
      </p>
    </motion.div>
  );
}
