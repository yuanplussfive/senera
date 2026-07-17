import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ListTree, Loader2, Maximize2, PanelRightClose } from "lucide-react";
import { useStore, type RunRecord } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Dialog, DialogContent, IconButton } from "../../shared/ui";
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
  onClosePanel,
}: {
  presentation?: "auto" | "panel";
  hidePanelTitle?: boolean;
  onClosePanel?: () => void;
}): JSX.Element {
  return <ThinkingPanel presentation={presentation} hidePanelTitle={hidePanelTitle} onClosePanel={onClosePanel} />;
}

function ThinkingPanel({
  presentation,
  hidePanelTitle,
  onClosePanel,
}: {
  presentation: "auto" | "panel";
  hidePanelTitle: boolean;
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
        className="flex h-full w-full shrink-0 flex-col bg-[var(--theme-elevated-bg)]"
        data-ui-chrome
        data-panel-presentation={presentation}
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
          onClosePanel={onClosePanel}
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
  onClosePanel,
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
  onClosePanel?: () => void;
}): JSX.Element {
  const summary = run ? summarizeRun(run) : undefined;

  return (
    <>
      <div
        className="relative z-10 flex h-[52px] items-center gap-2 border-b border-line-subtle bg-surface-raised px-3"
        data-window-drag-region
      >
        {hideTitle ? null : (
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
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label={frontendMessage("workflow.panel.focus")}
            tooltip={frontendMessage("workflow.panel.focus")}
            tooltipSide="bottom"
            aria-pressed={focusOpen}
            onClick={onToggleFocus}
          >
            <Maximize2 className="h-4 w-4" />
          </IconButton>
          {onClosePanel ? (
            <IconButton
              label={frontendMessage("workflow.panel.collapse")}
              tooltip={frontendMessage("workflow.panel.collapse")}
              tooltipSide="bottom"
              onClick={onClosePanel}
            >
              <PanelRightClose className="h-4 w-4" />
            </IconButton>
          ) : null}
        </div>
      </div>

      {runs.length > 0 ? (
        <div className="border-b border-line-subtle bg-surface-subtle/45 px-3 py-2">
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
        description={summary ? `${summary.completed}/${summary.total} 节点 · ${summary.tools} 工具` : undefined}
        placement="inset"
        motionPreset="focus"
        frameClassName="bottom-3 left-3 right-3 top-3 sm:bottom-4 sm:left-4 sm:right-4 sm:top-4"
        className="h-auto max-h-none w-auto max-w-none rounded-lg"
        bodyClassName="flex min-h-0 flex-1 flex-col bg-[var(--theme-workflow-canvas-bg)]"
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

function CanvasArea({ run, focusVersion = 0 }: { run?: RunRecord; focusVersion?: number }): JSX.Element {
  if (!shouldLoadWorkflowCanvas(run)) {
    return (
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--theme-workflow-canvas-bg)]">
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
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--theme-workflow-canvas-bg)]">
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
