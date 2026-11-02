import type { RunRecord } from "../../store/sessionStore";
import { ToolArtifactPreview } from "./ToolArtifactPreview";
import {
  collectToolResources,
  collectToolWorkspaceChanges,
  collectToolWorkspaceObservation,
  findReversibleWorkspaceCheckpoints,
} from "./toolResourceProjection";
import { isWorkspaceFileChange } from "./workspaceChangeActivity";

/** Shows the same contract at conversation-summary or dock-inspection density. */
export function ToolRunOutputSummary({
  mode = "summary",
  run,
}: {
  readonly mode?: "summary" | "detail";
  readonly run: RunRecord;
}): JSX.Element | null {
  const resources = collectToolResources(run.steps);
  const changes = collectToolWorkspaceChanges(run.steps);
  const fileChanges = changes.filter(isWorkspaceFileChange);
  if (resources.length === 0 && fileChanges.length === 0) return null;

  return (
    <div className="mt-4 min-w-0 border-t border-line-subtle/70 pt-3" data-tool-run-output-summary>
      <ToolArtifactPreview
        resources={resources}
        changes={fileChanges}
        checkpoints={findReversibleWorkspaceCheckpoints(run.steps, changes)}
        observation={collectToolWorkspaceObservation(run.steps)}
        mode={mode}
        enableHoverPreview={mode === "detail"}
      />
    </div>
  );
}
