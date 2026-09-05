import type { ToolWorkspaceCaptureResult } from "../Types/ToolRuntimeTypes.js";

export interface AgentWorkspaceChangeCaptureOptions {
  workspaceRoot: string;
}

export interface PreparedWorkspaceCapture {
  complete(result: unknown): Promise<ToolWorkspaceCaptureResult | undefined>;
}

export interface WorkspaceCaptureOptions {
  maxFileBytes: number;
  maxFiles: number;
  maxDirectoryDepth: number;
  captureContent: "none" | "text";
}

export interface ResolvedWorkspacePathRule {
  selector: string;
  base?: string;
}
