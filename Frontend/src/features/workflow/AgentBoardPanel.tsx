import { lazy, Suspense, useCallback, useMemo } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { AppIcon, Spinner } from "../../shared/ui";
import { useViewedRun } from "./useViewedRun";

const LazyChildRunBoard = lazy(() =>
  import("./ChildRunBoard").then((module) => ({
    default: module.ChildRunBoard,
  })),
);

/**
 * Right-dock tab body for delegated work: one board per run, following the
 * same pinned-run selection as the execution tab.
 */
export function AgentBoardPanel({
  focusedChildRunId,
  onClearFocus,
}: {
  focusedChildRunId?: string;
  onClearFocus?: () => void;
}): JSX.Element {
  const { run: viewedRun, runs, selectRun } = useViewedRun();
  const focusedRun = useMemo(
    () =>
      focusedChildRunId
        ? runs.find((candidate) => candidate.steps.some((step) => step.childRun?.id === focusedChildRunId))
        : undefined,
    [runs, focusedChildRunId],
  );
  const run = focusedRun ?? viewedRun;
  const clearFocus = useCallback((): void => {
    if (run) selectRun(run.requestId);
    onClearFocus?.();
  }, [run, selectRun, onClearFocus]);

  if (!run) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center" data-agent-board-panel>
        <AppIcon icon="git-branch" size={20} className="text-content-muted" aria-hidden="true" />
        <p className="mt-4 text-[13px] font-semibold text-content-primary">
          {frontendMessage("workflow.childRun.board.emptyTitle")}
        </p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-content-secondary">
          {frontendMessage("workflow.childRun.board.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-agent-board-panel>
      <Suspense
        fallback={
          <div className="flex h-full min-h-0 items-center justify-center">
            <Spinner size="sm" />
          </div>
        }
      >
        <LazyChildRunBoard
          key={run.requestId}
          run={run}
          focusedChildRunId={focusedChildRunId}
          onClearFocus={clearFocus}
        />
      </Suspense>
    </div>
  );
}

export default AgentBoardPanel;
