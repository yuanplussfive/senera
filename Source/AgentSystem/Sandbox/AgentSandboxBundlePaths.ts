import path from "node:path";

export const AgentSandboxBundleDirectoryName = "SandboxImage";
export const AgentSandboxReleaseDirectoryName = "Release";

export function resolveAgentSandboxPackagedBundleRoot(resourcesRoot: string): string {
  return path.resolve(resourcesRoot, AgentSandboxBundleDirectoryName);
}

export function resolveAgentSandboxDevelopmentBundleRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot, AgentSandboxReleaseDirectoryName, AgentSandboxBundleDirectoryName);
}
