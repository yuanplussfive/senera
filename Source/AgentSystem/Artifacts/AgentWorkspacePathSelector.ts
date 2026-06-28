import path from "node:path";
import {
  assertInsideRoot,
  toWorkspaceRelativePath,
} from "./AgentArtifactLocator.js";
import { selectJsonValues } from "./AgentArtifactJsonSelector.js";
import type { ResolvedWorkspacePathRule } from "./AgentWorkspaceCaptureTypes.js";

export class AgentWorkspacePathSelector {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  selectDeclaredPaths(
    root: unknown,
    rules: readonly ResolvedWorkspacePathRule[],
  ): Set<string> {
    const paths = new Set<string>();
    for (const rule of rules) {
      const values = selectJsonValues(root, rule.selector);
      const bases = rule.base ? selectJsonValues(root, rule.base) : [];
      values.forEach((value, index) => {
        if (typeof value !== "string" || value.trim().length === 0) {
          return;
        }

        const base = readString(bases[index]) ?? readString(bases[0]);
        paths.add(this.resolveDeclaredPath(value, base));
      });
    }
    return paths;
  }

  private resolveDeclaredPath(value: string, base: string | undefined): string {
    const baseAbsolutePath = base
      ? this.resolveInsideWorkspace(this.workspaceRoot, base)
      : this.workspaceRoot;
    const targetPath = this.resolveInsideWorkspace(baseAbsolutePath, value);
    return toWorkspaceRelativePath(this.workspaceRoot, targetPath);
  }

  private resolveInsideWorkspace(basePath: string, value: string): string {
    const target = path.isAbsolute(value)
      ? path.resolve(value)
      : path.resolve(basePath, value);
    return assertInsideRoot(
      this.workspaceRoot,
      target,
      `workspace snapshot 路径超出工作区：${value}`,
    );
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
