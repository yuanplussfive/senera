import type { ToolArtifactPolicyManifest, ToolArtifactWorkspaceManifest } from "../Types/AgentToolContractTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { AgentWorkspaceArtifactWriter } from "./AgentWorkspaceArtifactWriter.js";
import type { AgentArtifactFileWriter } from "./AgentArtifactFileWriter.js";

export function writeToolWorkspaceArtifacts(input: {
  artifactId: string;
  workspaceRoot: string;
  policy: ToolArtifactPolicyManifest | undefined;
  toolName: string;
  defaultPatchContextLines: number;
  workspaceCapture: NonNullable<ExecutedToolCallResult["workspaceCapture"]>;
  artifactDir: string;
  files: Record<string, string>;
  fileWriter: AgentArtifactFileWriter;
}) {
  const workspacePolicy = resolveWorkspacePolicy(input);
  if (!requiresWorkspaceArtifact(input.workspaceCapture)) return undefined;

  return new AgentWorkspaceArtifactWriter({
    artifactId: input.artifactId,
    workspaceRoot: input.workspaceRoot,
    workspacePolicy,
    workspaceCapture: input.workspaceCapture,
    artifactDir: input.artifactDir,
    files: input.files,
    fileWriter: input.fileWriter,
  }).write();
}

function requiresWorkspaceArtifact(capture: NonNullable<ExecutedToolCallResult["workspaceCapture"]>): boolean {
  if (capture.changes.some((change) => change.status !== "unchanged")) return true;
  // Keep old scanner-only captures readable if they are replayed into the
  // recorder. Receipt captures never produce warnings.
  return (capture.before.warnings?.length ?? 0) > 0 || (capture.after.warnings?.length ?? 0) > 0;
}

function resolveWorkspacePolicy(input: {
  readonly policy: ToolArtifactPolicyManifest | undefined;
  readonly toolName: string;
  readonly defaultPatchContextLines: number;
  readonly workspaceCapture: NonNullable<ExecutedToolCallResult["workspaceCapture"]>;
}): Pick<ToolArtifactWorkspaceManifest, "PatchContextLines"> {
  const hasExactReceipt =
    input.workspaceCapture.source === "mutation-receipt" ||
    input.workspaceCapture.sources?.includes("mutation-receipt") === true;
  if (hasExactReceipt) {
    if (!input.policy?.Workspace) {
      throw new Error(`${input.toolName} 生成了 workspace mutation receipt，但插件未声明 Artifacts.Workspace 策略。`);
    }
    return { PatchContextLines: input.policy.Workspace.PatchContextLines };
  }
  return { PatchContextLines: input.defaultPatchContextLines };
}
