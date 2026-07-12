import path from "node:path";
import type { ToolArtifactPolicyManifest } from "../Types/PluginManifestTypes.js";
import type { ToolWorkspaceSnapshot } from "../Types/ToolRuntimeTypes.js";
import {
  type AgentWorkspaceChangeCaptureOptions,
  type PreparedWorkspaceCapture,
  type WorkspaceCaptureOptions,
} from "./AgentWorkspaceCaptureTypes.js";
import { resolveWorkspaceCaptureOptions, resolveWorkspacePathRules } from "./AgentWorkspaceCapturePolicy.js";
import { AgentWorkspacePathSelector } from "./AgentWorkspacePathSelector.js";
import { AgentWorkspaceSnapshotBuilder } from "./AgentWorkspaceSnapshotBuilder.js";
import { compareWorkspaceSnapshots } from "./AgentWorkspaceSnapshotDiff.js";

export type { AgentWorkspaceChangeCaptureOptions, PreparedWorkspaceCapture } from "./AgentWorkspaceCaptureTypes.js";

export class AgentWorkspaceChangeCapture {
  private readonly workspaceRoot: string;
  private readonly pathSelector: AgentWorkspacePathSelector;

  constructor(options: AgentWorkspaceChangeCaptureOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.pathSelector = new AgentWorkspacePathSelector(this.workspaceRoot);
  }

  async prepare(input: {
    policy: ToolArtifactPolicyManifest | undefined;
    args: Record<string, unknown>;
  }): Promise<PreparedWorkspaceCapture> {
    const workspace = input.policy?.Workspace;
    if (!workspace || workspace.Capture !== "declared") {
      return new NoopWorkspaceCapture();
    }

    const rules = resolveWorkspacePathRules(workspace);
    const options = resolveWorkspaceCaptureOptions(workspace);
    const beforePaths = this.pathSelector.selectDeclaredPaths(input.args, rules);
    const before = await this.snapshot(beforePaths, options);

    return {
      complete: async (result: unknown) => {
        const afterPaths = new Set([...beforePaths, ...this.pathSelector.selectDeclaredPaths(result, rules)]);
        const after = await this.snapshot(afterPaths, options);
        return {
          before,
          after,
          changes: compareWorkspaceSnapshots(before, after),
        };
      },
    };
  }

  private async snapshot(
    relativePaths: Iterable<string>,
    options: WorkspaceCaptureOptions,
  ): Promise<ToolWorkspaceSnapshot> {
    const builder = new AgentWorkspaceSnapshotBuilder(this.workspaceRoot, options);
    for (const relativePath of [...relativePaths].sort()) {
      await builder.capture(relativePath, 0);
    }

    return builder.toSnapshot();
  }
}

class NoopWorkspaceCapture implements PreparedWorkspaceCapture {
  async complete(): Promise<undefined> {
    return undefined;
  }
}
