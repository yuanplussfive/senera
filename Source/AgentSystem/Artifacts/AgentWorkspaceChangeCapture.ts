import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type {
  ToolArtifactPolicyManifest,
  ToolArtifactWorkspaceManifest,
  ToolArtifactWorkspacePathManifest,
} from "../Types/PluginManifestTypes.js";
import type {
  ToolWorkspaceCaptureResult,
  ToolWorkspaceChange,
  ToolWorkspaceFileContentSnapshot,
  ToolWorkspaceFileSnapshot,
  ToolWorkspaceSnapshot,
} from "../Types/ToolRuntimeTypes.js";
import {
  assertInsideRoot,
  toPosixPath,
  toWorkspaceRelativePath,
} from "./AgentArtifactLocator.js";
import { selectJsonValues } from "./AgentArtifactJsonSelector.js";

const WorkspaceCaptureDefaults = {
  MaxFileBytes: 262144,
  MaxFiles: 256,
  MaxDirectoryDepth: 2,
  CaptureContent: "text",
} as const;

export interface AgentWorkspaceChangeCaptureOptions {
  workspaceRoot: string;
}

export interface PreparedWorkspaceCapture {
  complete(result: unknown): Promise<ToolWorkspaceCaptureResult | undefined>;
}

interface WorkspaceCaptureOptions {
  maxFileBytes: number;
  maxFiles: number;
  maxDirectoryDepth: number;
  captureContent: "none" | "text";
}

interface ResolvedWorkspacePathRule {
  selector: string;
  base?: string;
}

export class AgentWorkspaceChangeCapture {
  private readonly workspaceRoot: string;

  constructor(options: AgentWorkspaceChangeCaptureOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
  }

  async prepare(input: {
    policy: ToolArtifactPolicyManifest | undefined;
    args: Record<string, unknown>;
  }): Promise<PreparedWorkspaceCapture> {
    const workspace = input.policy?.Workspace;
    if (!workspace || workspace.Capture === "none") {
      return new NoopWorkspaceCapture();
    }

    if (workspace.Capture !== "declared") {
      return new NoopWorkspaceCapture();
    }

    const rules = resolvePathRules(workspace);
    const options = resolveCaptureOptions(workspace);
    const beforePaths = this.selectDeclaredPaths(input.args, rules);
    const before = await this.snapshot(beforePaths, options);

    return {
      complete: async (result: unknown) => {
        const afterPaths = new Set([
          ...beforePaths,
          ...this.selectDeclaredPaths(result, rules),
        ]);
        const after = await this.snapshot(afterPaths, options);
        return {
          before,
          after,
          changes: compareSnapshots(before, after),
        };
      },
    };
  }

  private selectDeclaredPaths(
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

  private async snapshot(
    relativePaths: Iterable<string>,
    options: WorkspaceCaptureOptions,
  ): Promise<ToolWorkspaceSnapshot> {
    const builder = new WorkspaceSnapshotBuilder(this.workspaceRoot, options);
    for (const relativePath of [...relativePaths].sort()) {
      await builder.capture(relativePath, 0);
    }

    return builder.toSnapshot();
  }
}

class WorkspaceSnapshotBuilder {
  private readonly files: ToolWorkspaceFileSnapshot[] = [];
  private readonly visited = new Set<string>();
  private readonly warnings: string[] = [];
  private stopped = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly options: WorkspaceCaptureOptions,
  ) {}

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
    const absolutePath = assertInsideRoot(
      this.workspaceRoot,
      path.resolve(this.workspaceRoot, relativePath),
      `workspace snapshot 路径超出工作区：${relativePath}`,
    );

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
          hash: hashText(target),
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
        hash: hashText(`${kind}:${stat.size}:${Math.floor(stat.mtimeMs)}`),
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

      return missingSnapshot(relativePath, absolutePath);
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
      hash: content.state === "captured" && content.text !== undefined
        ? hashText(content.text)
        : await hashFile(absolutePath),
      content,
    };
  }

  private async captureFileContent(
    absolutePath: string,
    size: number,
  ): Promise<ToolWorkspaceFileContentSnapshot> {
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

class NoopWorkspaceCapture implements PreparedWorkspaceCapture {
  async complete(): Promise<undefined> {
    return undefined;
  }
}

function resolvePathRules(workspace: ToolArtifactWorkspaceManifest): ResolvedWorkspacePathRule[] {
  return workspace.Paths?.map((entry: ToolArtifactWorkspacePathManifest) => ({
    selector: entry.Selector,
    base: entry.Base,
  })) ?? [];
}

function resolveCaptureOptions(workspace: ToolArtifactWorkspaceManifest): WorkspaceCaptureOptions {
  return {
    maxFileBytes: workspace.MaxFileBytes ?? WorkspaceCaptureDefaults.MaxFileBytes,
    maxFiles: workspace.MaxFiles ?? WorkspaceCaptureDefaults.MaxFiles,
    maxDirectoryDepth: workspace.MaxDirectoryDepth ?? WorkspaceCaptureDefaults.MaxDirectoryDepth,
    captureContent: workspace.CaptureContent ?? WorkspaceCaptureDefaults.CaptureContent,
  };
}

function compareSnapshots(
  before: ToolWorkspaceSnapshot,
  after: ToolWorkspaceSnapshot,
): ToolWorkspaceChange[] {
  const beforeByPath = new Map(before.files.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(after.files.map((entry) => [entry.path, entry]));
  const paths = new Set([
    ...beforeByPath.keys(),
    ...afterByPath.keys(),
  ]);

  return [...paths].sort().map((filePath) => {
    const left = beforeByPath.get(filePath) ?? missingSnapshot(filePath, afterByPath.get(filePath)?.absolutePath ?? "");
    const right = afterByPath.get(filePath) ?? missingSnapshot(filePath, left.absolutePath);
    return {
      path: filePath,
      absolutePath: right.absolutePath || left.absolutePath,
      status: changeStatus(left, right),
      beforeKind: left.kind,
      afterKind: right.kind,
      beforeHash: left.hash,
      afterHash: right.hash,
      beforeSize: left.size,
      afterSize: right.size,
    };
  });
}

function changeStatus(
  before: ToolWorkspaceFileSnapshot,
  after: ToolWorkspaceFileSnapshot,
): ToolWorkspaceChange["status"] {
  if (!before.exists && after.exists) {
    return "added";
  }
  if (before.exists && !after.exists) {
    return "deleted";
  }
  if (before.kind !== after.kind) {
    return "type_changed";
  }
  return before.hash === after.hash ? "unchanged" : "modified";
}

function missingSnapshot(filePath: string, absolutePath: string): ToolWorkspaceFileSnapshot {
  return {
    path: filePath,
    absolutePath,
    exists: false,
    kind: "missing",
    size: 0,
    mtimeMs: 0,
    hash: "",
    content: {
      state: "omitted",
      reason: "missing",
      byteLength: 0,
    },
  };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return `sha256:${hash.digest("hex")}`;
}

function hashText(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeWorkspaceRelativePath(value: string): string {
  return toPosixPath(path.normalize(value)).replace(/^\.\//, "");
}

function joinWorkspacePath(base: string, name: string): string {
  return normalizeWorkspaceRelativePath(base ? path.join(base, name) : name);
}

function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }
  if (buffer.includes(0)) {
    return true;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  const suspicious = sample.reduce((count, byte) =>
    count + (byte < 8 || (byte > 13 && byte < 32) ? 1 : 0), 0);
  return suspicious / sample.length > 0.3;
}

function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  return value.endsWith("\n")
    ? value.slice(0, -1).split("\n").length
    : value.split("\n").length;
}
