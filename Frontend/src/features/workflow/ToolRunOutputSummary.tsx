import type { RunRecord } from "../../store/sessionStore";
import { ToolArtifactPreview } from "./ToolArtifactPreview";
import { collectToolResources, collectToolWorkspaceChanges } from "./toolResourceProjection";
import { isWorkspaceFileChange } from "./workspaceChangeActivity";

/** Shows the durable output of a run in the conversation without duplicating
 * tool arguments or execution diagnostics from the workflow dock. */
export function ToolRunOutputSummary({ run }: { readonly run: RunRecord }): JSX.Element | null {
  const resources = collectToolResources(run.steps);
  const changes = collectToolWorkspaceChanges(run.steps);
  const fileChanges = changes.filter(isWorkspaceFileChange);
  if (resources.length === 0 && fileChanges.length === 0) return null;

  return (
    <div className="mt-4 min-w-0 border-t border-line-subtle/70 pt-3" data-tool-run-output-summary>
      <ToolArtifactPreview resources={resources} changes={fileChanges} enableHoverPreview={false} />
    </div>
  );
}
