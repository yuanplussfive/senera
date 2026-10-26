import { lazy, Suspense } from "react";
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
export function AgentBoardPanel(): JSX.Element {
  const { run } = useViewedRun();

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
        <LazyChildRunBoard run={run} />
      </Suspense>
    </div>
  );
}

export default AgentBoardPanel;
