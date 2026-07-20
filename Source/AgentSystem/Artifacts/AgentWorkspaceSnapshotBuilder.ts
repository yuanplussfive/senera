import fs from "node:fs/promises";
import path from "node:path";
import type {
  ToolWorkspaceFileContentSnapshot,
  ToolWorkspaceFileSnapshot,
  ToolWorkspaceSnapshot,
} from "../Types/ToolRuntimeTypes.js";
import { assertInsideRoot } from "./AgentArtifactLocator.js";
import { SeneraWorkspaceBoundary, SeneraWorkspaceBoundaryError } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import type { WorkspaceCaptureOptions } from "./AgentWorkspaceCaptureTypes.js";
import {
  countLines,
  hashWorkspaceFile,
  hashWorkspaceText,
  isProbablyBinary,
  joinWorkspacePath,
  missingWorkspaceSnapshot,
  normalizeWorkspaceRelativePath,
} from "./AgentWorkspaceSnapshotUtils.js";

export class AgentWorkspaceSnapshotBuilder {
  private readonly files: ToolWorkspaceFileSnapshot[] = [];
  private readonly visited = new Set<string>();
  private readonly warnings: string[] = [];
  private readonly boundary: SeneraWorkspaceBoundary;
  private stopped = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly options: WorkspaceCaptureOptions,
  ) {
    this.boundary = new SeneraWorkspaceBoundary({ workspaceRoot });
  }

  async capture(relativePath: string, depth: number): Promise<void> {
    if (this.stopped) {
      return;
    }

    const normalizedPath = normalizeWorkspaceRelativePath(relativePath);
    if (this.visited.has(normalizedPath)) {
      return;
    }

    if (this.files.length >= this.options.maxFiles) {
      this.stopped = true;
      this.warnings.push(`workspace snapshot reached MaxFiles=${this.options.maxFiles}`);
      return;
    }

    this.visited.add(normalizedPath);
    const snapshot = await this.snapshotPath(normalizedPath);
    this.files.push(snapshot);

    if (snapshot.kind !== "directory" || !snapshot.exists) {
      return;
    }

    if (depth >= this.options.maxDirectoryDepth) {
      this.warnings.push(`workspace snapshot skipped nested directory: ${normalizedPath}`);
      return;
    }

    const entries = await fs.readdir(snapshot.absolutePath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      await this.capture(joinWorkspacePath(normalizedPath, entry.name), depth + 1);
    }
  }

  toSnapshot(): ToolWorkspaceSnapshot {
    const warnings = this.warnings.length > 0 ? [...this.warnings] : undefined;
    return {
      capturedAt: new Date().toISOString(),
      files: this.files.sort((left, right) => left.path.localeCompare(right.path)),
      warnings,
    };
  }

  private async snapshotPath(relativePath: string): Promise<ToolWorkspaceFileSnapshot> {
    const addressedPath = assertInsideRoot(
      this.workspaceRoot,
      path.resolve(this.workspaceRoot, relativePath),
      `workspace snapshot 路径超出工作区：${relativePath}`,
    );
    let absolutePath: string;
    try {
      absolutePath = (await this.boundary.resolve(relativePath, AgentResourceAccessIntents.Read)).absolutePath;
    } catch (error) {
      if (!(error instanceof SeneraWorkspaceBoundaryError)) throw error;
      this.warnings.push(`workspace snapshot rejected unsafe path: ${relativePath}`);
      return missingWorkspaceSnapshot(relativePath, addressedPath);
    }

    try {
      const stat = await fs.lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(absolutePath);
        return {
          path: relativePath,
          absolutePath,
          exists: true,
          kind: "symlink",
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          hash: hashWorkspaceText(target),
          target,
          content: {
            state: "omitted",
            reason: "unsupported",
            byteLength: stat.size,
          },
        };
      }

      if (stat.isFile()) {
        return this.snapshotFile(relativePath, absolutePath, stat);
      }

      const kind = stat.isDirectory() ? "directory" : "other";
      return {
        path: relativePath,
        absolutePath,
        exists: true,
        kind,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        hash: hashWorkspaceText(`${kind}:${stat.size}:${Math.floor(stat.mtimeMs)}`),
        content: {
          state: "omitted",
          reason: kind === "directory" ? "directory" : "unsupported",
          byteLength: stat.size,
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      return missingWorkspaceSnapshot(relativePath, absolutePath);
    }
  }

  private async snapshotFile(
    relativePath: string,
    absolutePath: string,
    stat: { size: number; mtimeMs: number },
  ): Promise<ToolWorkspaceFileSnapshot> {
    const content = await this.captureFileContent(absolutePath, stat.size);
    return {
      path: relativePath,
      absolutePath,
      exists: true,
      kind: "file",
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash:
        content.state === "captured" && content.text !== undefined
          ? hashWorkspaceText(content.text)
          : await hashWorkspaceFile(absolutePath),
      content,
    };
  }

  private async captureFileContent(absolutePath: string, size: number): Promise<ToolWorkspaceFileContentSnapshot> {
    if (this.options.captureContent === "none") {
      return {
        state: "omitted",
        reason: "not_requested",
        byteLength: size,
      };
    }

    if (size > this.options.maxFileBytes) {
      return {
        state: "omitted",
        reason: "size_limit",
        byteLength: size,
      };
    }

    const buffer = await fs.readFile(absolutePath);
    if (isProbablyBinary(buffer)) {
      return {
        state: "omitted",
        reason: "binary",
        byteLength: buffer.byteLength,
      };
    }

    const text = buffer.toString("utf8");
    return {
      state: "captured",
      encoding: "utf8",
      byteLength: buffer.byteLength,
      lineCount: countLines(text),
      text,
    };
  }
}
