import { useMemo } from "react";
import type { TimelineChildRunState, TimelineStep } from "../../store/sessionStore";
import { ChildRunOverview } from "./ChildRunOverview";
import { ChildRunExecutionTrace } from "./ChildRunExecutionTrace";

export function ChildRunExecutionDetail({
  childRun,
  steps,
}: {
  childRun: TimelineChildRunState;
  steps: readonly TimelineStep[];
}): JSX.Element {
  const tools = useMemo(
    () => steps.filter((step) => step.scope?.childRunId === childRun.id && step.kind === "tool"),
    [steps, childRun.id],
  );
  return (
    <div className="flex min-w-0 flex-col gap-5" data-child-run-detail>
      <ChildRunOverview childRun={childRun} />
      <ChildRunExecutionTrace childRun={childRun} childToolSteps={tools} />
    </div>
  );
}
