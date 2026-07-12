import type { ToolArtifactPolicyManifest, ToolArtifactWorkspaceManifest } from "../Types/PluginManifestTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { AgentWorkspaceArtifactWriter } from "./AgentWorkspaceArtifactWriter.js";

export function writeToolWorkspaceArtifacts(input: {
  workspaceRoot: string;
  policy: ToolArtifactPolicyManifest | undefined;
  toolName: string;
  workspaceCapture: NonNullable<ExecutedToolCallResult["workspaceCapture"]>;
  artifactDir: string;
  files: Record<string, string>;
}) {
  return new AgentWorkspaceArtifactWriter({
    workspaceRoot: input.workspaceRoot,
    workspacePolicy: requireWorkspacePolicy(input.policy, input.toolName),
    workspaceCapture: input.workspaceCapture,
    artifactDir: input.artifactDir,
    files: input.files,
  }).write();
}

function requireWorkspacePolicy(
  policy: ToolArtifactPolicyManifest | undefined,
  toolName: string,
): ToolArtifactWorkspaceManifest {
  if (!policy?.Workspace) {
    throw new Error(`${toolName} 生成了 workspace artifact，但插件未声明 Artifacts.Workspace 策略。`);
  }
  return policy.Workspace;
}
