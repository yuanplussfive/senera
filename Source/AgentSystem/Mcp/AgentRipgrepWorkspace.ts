import path from "node:path";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";

export interface AgentRipgrepWorkspaceTarget {
  readonly cwd: string;
  readonly searchPath: string;
}

export async function resolveAgentRipgrepWorkspaceTarget(
  workspaceRoot: string,
  requestedPath: string,
): Promise<AgentRipgrepWorkspaceTarget> {
  const boundary = new SeneraWorkspaceBoundary({ workspaceRoot });
  const [root, target] = await Promise.all([
    boundary.resolve(".", AgentResourceAccessIntents.Execute),
    boundary.resolve(requestedPath, AgentResourceAccessIntents.Read),
  ]);
  const relative = path.relative(root.absolutePath, target.absolutePath);

  return {
    cwd: root.absolutePath,
    searchPath: relative.length === 0 ? "." : relative,
  };
}
