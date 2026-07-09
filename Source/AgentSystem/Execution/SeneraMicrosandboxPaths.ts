import path from "node:path";
import { projectHostPathToGuestPath } from "./SeneraGuestPathProjection.js";

export interface SeneraMicrosandboxWorkspaceMount {
  hostWorkspaceRoot: string;
  guestWorkspaceRoot: string;
  hostCwd: string;
  guestCwd: string;
}

export function projectMicrosandboxWorkspaceMount(input: {
  workspaceRoot: string;
  cwd: string;
  guestWorkspaceRoot: string;
}): SeneraMicrosandboxWorkspaceMount {
  const hostWorkspaceRoot = path.resolve(input.workspaceRoot);
  const hostCwd = path.resolve(input.cwd);
  const relativeCwd = path.relative(hostWorkspaceRoot, hostCwd);
  return {
    hostWorkspaceRoot,
    guestWorkspaceRoot: input.guestWorkspaceRoot,
    hostCwd,
    guestCwd: projectHostPathToGuestPath({
      hostRoot: hostWorkspaceRoot,
      hostPath: path.resolve(hostWorkspaceRoot, relativeCwd),
      guestRoot: input.guestWorkspaceRoot,
    }),
  };
}
