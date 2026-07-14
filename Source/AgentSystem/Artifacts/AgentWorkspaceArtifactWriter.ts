import path from "node:path";
import { createTwoFilesPatch } from "diff";
import type { ToolArtifactWorkspaceManifest } from "../Types/PluginManifestTypes.js";
import type {
  ToolWorkspaceCaptureResult,
  ToolWorkspaceChange,
  ToolWorkspaceFileSnapshot,
  ToolWorkspaceSnapshot,
} from "../Types/ToolRuntimeTypes.js";
import { assertInsideRoot, toPosixPath } from "./AgentArtifactLocator.js";
import { AgentArtifactFileWriter } from "./AgentArtifactFileWriter.js";

export interface AgentWorkspaceArtifactWriterOptions {
  workspaceRoot: string;
  workspacePolicy: ToolArtifactWorkspaceManifest;
  workspaceCapture: ToolWorkspaceCaptureResult;
  artifactDir: string;
  files: Record<string, string>;
}

export interface WrittenWorkspaceArtifacts {
  before: ToolWorkspaceSnapshot;
  after: ToolWorkspaceSnapshot;
  changes: ToolWorkspaceChange[];
  patch: {
    path: string;
    relativePath: string;
    generated: boolean;
    changeCount: number;
  };
}

interface WorkspaceContentWriteResult {
  snapshot: ToolWorkspaceSnapshot;
  byPath: Map<string, ToolWorkspaceFileSnapshot>;
}

export class AgentWorkspaceArtifactWriter {
  private readonly fileWriter: AgentArtifactFileWriter;

  constructor(private readonly options: AgentWorkspaceArtifactWriterOptions) {
    this.fileWriter = new AgentArtifactFileWriter(options.workspaceRoot);
  }

  async write(): Promise<WrittenWorkspaceArtifacts> {
    const before = await this.writeSnapshotContents({
      snapshot: this.options.workspaceCapture.before,
      rootDir: this.options.files.workspaceBeforeDir,
      relativeRoot: "workspace/before",
    });
    const after = await this.writeSnapshotContents({
      snapshot: this.options.workspaceCapture.after,
      rootDir: this.options.files.workspaceAfterDir,
      relativeRoot: "workspace/after",
    });
    const changes = this.options.workspaceCapture.changes.map((change) =>
      this.annotatePatchReference(change, before.byPath, after.byPath),
    );
    const patchText = this.buildUnifiedPatch(changes, before.byPath, after.byPath);
    await this.fileWriter.writeText(this.options.files.workspacePatch, patchText, Number.MAX_SAFE_INTEGER);

    return {
      before: before.snapshot,
      after: after.snapshot,
      changes,
      patch: {
        path: this.options.files.workspacePatch,
        relativePath: toArtifactRelativePath(this.options.artifactDir, this.options.files.workspacePatch),
        generated: patchText.trim().length > 0,
        changeCount: changes.filter((change) => change.patch?.status === "generated").length,
      },
    };
  }

  private async writeSnapshotContents(input: {
    snapshot: ToolWorkspaceSnapshot;
    rootDir: string;
    relativeRoot: string;
  }): Promise<WorkspaceContentWriteResult> {
    const files: ToolWorkspaceFileSnapshot[] = [];
    const byPath = new Map<string, ToolWorkspaceFileSnapshot>();

    for (const entry of input.snapshot.files) {
      const next = await this.writeContent(entry, input.rootDir, input.relativeRoot);
      files.push(withoutInlineText(next));
      byPath.set(next.path, next);
    }

    return {
      snapshot: {
        ...input.snapshot,
        files,
      },
      byPath,
    };
  }

  private async writeContent(
    entry: ToolWorkspaceFileSnapshot,
    rootDir: string,
    relativeRoot: string,
  ): Promise<ToolWorkspaceFileSnapshot> {
    if (entry.content?.state !== "captured" || entry.content.text === undefined) {
      return entry;
    }

    const relativePath = safeArtifactFilePath(entry.path);
    const artifactPath = assertInsideRoot(
      rootDir,
      path.resolve(rootDir, relativePath),
      `workspace artifact 内容路径超出目录：${entry.path}`,
    );
    await this.fileWriter.writeText(artifactPath, entry.content.text, Number.MAX_SAFE_INTEGER);

    return {
      ...entry,
      content: {
        ...entry.content,
        artifactPath,
        relativeArtifactPath: toPosixPath(path.join(relativeRoot, relativePath)),
      },
    };
  }

  private annotatePatchReference(
    change: ToolWorkspaceChange,
    before: ReadonlyMap<string, ToolWorkspaceFileSnapshot>,
    after: ReadonlyMap<string, ToolWorkspaceFileSnapshot>,
  ): ToolWorkspaceChange {
    if (change.status === "unchanged") {
      return {
        ...change,
        patch: {
          status: "skipped",
          reason: "unchanged",
        },
      };
    }

    const left = before.get(change.path);
    const right = after.get(change.path);
    const patchable = readPatchableText(left) || readPatchableText(right);
    if (!patchable) {
      return {
        ...change,
        patch: {
          status: "skipped",
          reason: this.describePatchSkip(left, right),
        },
      };
    }

    return {
      ...change,
      patch: {
        status: "generated",
        path: this.options.files.workspacePatch,
        relativePath: toArtifactRelativePath(this.options.artifactDir, this.options.files.workspacePatch),
      },
    };
  }

  private buildUnifiedPatch(
    changes: readonly ToolWorkspaceChange[],
    before: ReadonlyMap<string, ToolWorkspaceFileSnapshot>,
    after: ReadonlyMap<string, ToolWorkspaceFileSnapshot>,
  ): string {
    const parts = changes.flatMap((change) => {
      if (change.patch?.status !== "generated") {
        return [];
      }

      const left = before.get(change.path);
      const right = after.get(change.path);
      const oldText = readPatchableText(left) ?? "";
      const newText = readPatchableText(right) ?? "";
      if (oldText === newText) {
        return [];
      }

      return [
        createTwoFilesPatch(
          oldPatchPath(change.path),
          newPatchPath(change.path),
          oldText,
          newText,
          patchHeader(left),
          patchHeader(right),
          {
            context: this.options.workspacePolicy.PatchContextLines,
          },
        ).trimEnd(),
      ];
    });

    return parts.length > 0 ? `${parts.join("\n")}\n` : "";
  }

  private describePatchSkip(
    before: ToolWorkspaceFileSnapshot | undefined,
    after: ToolWorkspaceFileSnapshot | undefined,
  ): string {
    const content = after?.content ?? before?.content;
    if (!content || content.state === "captured") {
      return "not_text_file";
    }
    return content.reason;
  }
}

function readPatchableText(entry: ToolWorkspaceFileSnapshot | undefined): string | undefined {
  return entry?.content?.state === "captured" ? entry.content.text : undefined;
}

function withoutInlineText(entry: ToolWorkspaceFileSnapshot): ToolWorkspaceFileSnapshot {
  if (entry.content?.state !== "captured") {
    return entry;
  }

  const { text: _text, ...content } = entry.content;
  return {
    ...entry,
    content,
  };
}

function patchHeader(entry: ToolWorkspaceFileSnapshot | undefined): string {
  if (!entry?.exists) {
    return "missing";
  }
  return `${entry.hash} ${new Date(entry.mtimeMs).toISOString()}`;
}

function oldPatchPath(filePath: string): string {
  return `a/${filePath}`;
}

function newPatchPath(filePath: string): string {
  return `b/${filePath}`;
}

function safeArtifactFilePath(value: string): string {
  return value
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .join(path.sep);
}

function toArtifactRelativePath(artifactDir: string, filePath: string): string {
  return toPosixPath(path.relative(artifactDir, filePath));
}
