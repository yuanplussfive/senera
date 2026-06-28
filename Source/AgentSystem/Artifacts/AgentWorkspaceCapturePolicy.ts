import type {
  ToolArtifactWorkspaceManifest,
  ToolArtifactWorkspacePathManifest,
} from "../Types/PluginManifestTypes.js";
import type {
  ResolvedWorkspacePathRule,
  WorkspaceCaptureOptions,
} from "./AgentWorkspaceCaptureTypes.js";

const WorkspaceCaptureDefaults = {
  MaxFileBytes: 262144,
  MaxFiles: 256,
  MaxDirectoryDepth: 2,
  CaptureContent: "text",
} as const;

export function resolveWorkspacePathRules(
  workspace: ToolArtifactWorkspaceManifest,
): ResolvedWorkspacePathRule[] {
  return workspace.Paths?.map((entry: ToolArtifactWorkspacePathManifest) => ({
    selector: entry.Selector,
    base: entry.Base,
  })) ?? [];
}

export function resolveWorkspaceCaptureOptions(
  workspace: ToolArtifactWorkspaceManifest,
): WorkspaceCaptureOptions {
  return {
    maxFileBytes: workspace.MaxFileBytes ?? WorkspaceCaptureDefaults.MaxFileBytes,
    maxFiles: workspace.MaxFiles ?? WorkspaceCaptureDefaults.MaxFiles,
    maxDirectoryDepth: workspace.MaxDirectoryDepth ?? WorkspaceCaptureDefaults.MaxDirectoryDepth,
    captureContent: workspace.CaptureContent ?? WorkspaceCaptureDefaults.CaptureContent,
  };
}
