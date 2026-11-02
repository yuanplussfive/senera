import { memo, useCallback, useMemo, useState } from "react";
import type { RunRecord, TimelineStep } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { ActivityStatusIcon, AppIcon, IconButton, Tooltip } from "../../shared/ui";
import { readRunInputLabel } from "../../store/session/runInputLabel";
import { childRunPreview, childRunStatus, isChildRunActive } from "./childRunPresentation";
import { ChildRunMetrics } from "./ChildRunOverview";
import { ChildRunExecutionDetail } from "./ChildRunExecutionDetail";
import { ChildRunElapsed } from "./ChildRunElapsed";
import { useChildRunNavigation } from "./ChildRunNavigation";
import "./childRuns.css";

export function ChildRunBoard({
  run,
  focusedChildRunId,
  onClearFocus,
}: {
  run: RunRecord;
  focusedChildRunId?: string;
  onClearFocus?: () => void;
}): JSX.Element {
  const [selectedChildRunId, setSelectedChildRunId] = useState<string | null>(null);
  const navigation = useChildRunNavigation();
  const selectChildRun = useCallback(
    (id: string): void => {
      setSelectedChildRunId(id);
      navigation?.open(id);
    },
    [navigation],
  );
  const childSteps = useMemo(() => {
    const seen = new Set<string>();
    return run.steps.filter((step) => {
      if (!step.childRun || seen.has(step.childRun.id)) return false;
      seen.add(step.childRun.id);
      return true;
    });
  }, [run.steps]);
  const selectedStep = childSteps.find((step) => step.childRun?.id === (focusedChildRunId ?? selectedChildRunId));
  const activeCount = childSteps.filter((step) => isChildRunActive(step.childRun!.status)).length;

  if (selectedStep?.childRun) {
    return (
      <section className="child-run-board" data-child-run-board>
        <header className="flex h-[58px] shrink-0 items-center gap-2 border-b border-line-subtle px-3">
          <IconButton
            label={frontendMessage("workflow.childRun.backToList")}
            size="sm"
            tone="muted"
            onClick={() => {
              setSelectedChildRunId(null);
              onClearFocus?.();
            }}
          >
            <AppIcon icon="arrow-left" size={16} />
          </IconButton>
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-content-primary">
            {selectedStep.scope?.agentName || frontendMessage("workflow.childRun.board.agentFallback")}
          </h2>
          <ChildRunElapsed
            startedAt={selectedStep.childRun.startedAt}
            completedAt={selectedStep.childRun.completedAt}
            status={selectedStep.childRun.status}
          />
        </header>
        <div className="child-run-board__detail" key={selectedStep.childRun.id}>
          <ChildRunExecutionDetail childRun={selectedStep.childRun} steps={run.steps} />
        </div>
      </section>
    );
  }

  return (
    <section
      className="child-run-board"
      aria-label={frontendMessage("workflow.childRun.board.title")}
      data-child-run-board
    >
      <header className="child-run-board__header">
        <div className="flex items-center gap-2">
          <AppIcon icon="delegation" size={16} className="text-content-secondary" />
          <h2 className="flex-1 text-[13px] font-semibold text-content-primary">
            {frontendMessage("workflow.childRun.board.title")}
          </h2>
          <span className="text-[11px] tabular-nums text-content-muted" role="status">
            {frontendMessage("workflow.childRun.board.counts", { active: activeCount, total: childSteps.length })}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 break-words text-[12px] leading-5 text-content-secondary">
          {readRunInputLabel(run)}
        </p>
      </header>
      <div className="child-run-board__list">
        {childSteps.length ? (
          childSteps.map((step) => <ChildRunRow key={step.id} step={step} onSelect={selectChildRun} />)
        ) : (
          <p className="px-4 py-12 text-center text-[12px] leading-5 text-content-secondary">
            {frontendMessage("workflow.childRun.board.empty")}
          </p>
        )}
      </div>
    </section>
  );
}

const ChildRunRow = memo(function ChildRunRow({
  step,
  onSelect,
}: {
  step: TimelineStep;
  onSelect: (id: string) => void;
}): JSX.Element {
  const childRun = step.childRun!;
  const presentation = childRunStatus(childRun.status);
  const name = step.scope?.agentName || frontendMessage("workflow.childRun.board.agentFallback");
  return (
    <button
      type="button"
      onClick={() => onSelect(childRun.id)}
      className="child-run-row"
      data-child-run-item
      data-child-run-card
      data-child-run-status={childRun.status}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ActivityStatusIcon status={presentation.activity} size={15} motion="spin" className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-content-primary">{name}</span>
        <span
          className={cn("max-w-[55%] truncate text-[11px]", presentation.text)}
          title={frontendMessage(presentation.label)}
        >
          {frontendMessage(presentation.label)}
        </span>
        <AppIcon icon="chevron-right" size={13} className="shrink-0 text-content-muted" />
      </div>
      {childRun.taskLabel ? (
        <p className="mt-1 truncate pl-[23px] text-[11px] text-content-muted">{childRun.taskLabel}</p>
      ) : null}
      <p className="child-run-preview" data-child-run-preview>
        {childRunPreview(childRun, false)}
      </p>
      <div className="child-run-row__meta">
        <ChildRunMetrics childRun={childRun} />
        {childRun.checkpointAvailable ? (
          <Tooltip content={frontendMessage("workflow.childRun.board.checkpoint")}>
            <span
              className="inline-flex text-content-muted"
              aria-label={frontendMessage("workflow.childRun.board.checkpoint")}
            >
              <AppIcon icon="flag" size={12} />
            </span>
          </Tooltip>
        ) : null}
        <span className="ml-auto">
          <ChildRunElapsed startedAt={childRun.startedAt} completedAt={childRun.completedAt} status={childRun.status} />
        </span>
      </div>
    </button>
  );
});

export default ChildRunBoard;
