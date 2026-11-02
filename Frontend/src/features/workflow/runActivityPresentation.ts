import type { RunRecord } from "../../store/sessionStore";
export * from "./runActivityLabels";

export function hasVisibleRunFeedback(
  run?: RunRecord,
  { includeWorkflowTrace = false }: { includeWorkflowTrace?: boolean } = {},
): boolean {
  if (!run) return false;
  return Boolean(
    run.liveActivity ||
    run.activities?.length ||
    run.thinkingBlocks?.some((block) => block.content.trim()) ||
    run.displayText.trim() ||
    run.visibleText?.trim() ||
    run.steps.some(
      (step) =>
        (step.kind === "tool" && step.toolName?.trim()) ||
        (step.kind === "delegation" && step.childRun) ||
        (includeWorkflowTrace && step.kind !== "model" && step.title?.trim()),
    ),
  );
}
