import type {
  ToolWorkspaceChange,
  ToolWorkspaceFileSnapshot,
  ToolWorkspaceSnapshot,
} from "../Types/ToolRuntimeTypes.js";
import { diffLines } from "diff";
import { missingWorkspaceSnapshot } from "./AgentWorkspaceSnapshotUtils.js";

export function compareWorkspaceSnapshots(
  before: ToolWorkspaceSnapshot,
  after: ToolWorkspaceSnapshot,
): ToolWorkspaceChange[] {
  const beforeByPath = new Map(before.files.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(after.files.map((entry) => [entry.path, entry]));
  const paths = new Set([...beforeByPath.keys(), ...afterByPath.keys()]);

  const changes = [...paths].sort().flatMap((filePath) => {
    const left =
      beforeByPath.get(filePath) ?? missingWorkspaceSnapshot(filePath, afterByPath.get(filePath)?.absolutePath ?? "");
    const right = afterByPath.get(filePath) ?? missingWorkspaceSnapshot(filePath, left.absolutePath);
    if (!left.exists && !right.exists) return [];
    // Directory mtimes are traversal metadata, not user-facing workspace
    // changes. A child file mutation must not produce a second synthetic row.
    if (left.kind === "directory" && right.kind === "directory") return [];
    const lineChanges = projectLineChanges(left, right);
    return [
      {
        path: filePath,
        absolutePath: right.absolutePath || left.absolutePath,
        status: workspaceChangeStatus(left, right),
        beforeKind: left.kind,
        afterKind: right.kind,
        beforeHash: left.hash,
        afterHash: right.hash,
        beforeSize: left.size,
        afterSize: right.size,
        ...lineChanges,
      },
    ];
  });

  // A directory is traversal context, not an additional file mutation. Keep
  // an empty directory change visible, but suppress the parent row whenever a
  // descendant file already explains the same operation.
  return changes.filter((change) => {
    if (change.beforeKind !== "directory" && change.afterKind !== "directory") return true;
    return !changes.some(
      (candidate) =>
        candidate !== change &&
        candidate.status !== "unchanged" &&
        isDescendantPath(candidate.path, change.path) &&
        candidate.beforeKind !== "directory" &&
        candidate.afterKind !== "directory",
    );
  });
}

/**
 * A directory is part of workspace provenance, but it is not a file output.
 * Type changes retain file semantics when either side was a regular file so
 * a file-to-directory replacement is not silently lost from the file delta.
 */
export function isWorkspaceFileChange(change: Pick<ToolWorkspaceChange, "beforeKind" | "afterKind">): boolean {
  return change.beforeKind === "file" || change.afterKind === "file";
}

/**
 * Directory entries are retained as provenance, but they form their own
 * workspace category. A file-to-directory replacement stays in the file
 * category so one mutation is never counted twice.
 */
export function isWorkspaceDirectoryChange(change: Pick<ToolWorkspaceChange, "beforeKind" | "afterKind">): boolean {
  return !isWorkspaceFileChange(change) && (change.beforeKind === "directory" || change.afterKind === "directory");
}

function isDescendantPath(candidate: string, parent: string): boolean {
  if (!parent) return candidate.length > 0;
  return candidate.startsWith(`${parent}/`);
}

function projectLineChanges(
  before: ToolWorkspaceFileSnapshot,
  after: ToolWorkspaceFileSnapshot,
): Pick<ToolWorkspaceChange, "addedLines" | "removedLines"> {
  const oldText = readCapturedText(before);
  const newText = readCapturedText(after);
  if (oldText === undefined && newText === undefined) return {};

  return diffLines(oldText ?? "", newText ?? "").reduce(
    (stats, change) => ({
      addedLines: stats.addedLines + (change.added ? change.count : 0),
      removedLines: stats.removedLines + (change.removed ? change.count : 0),
    }),
    { addedLines: 0, removedLines: 0 },
  );
}

function readCapturedText(snapshot: ToolWorkspaceFileSnapshot): string | undefined {
  return snapshot.content?.state === "captured" ? snapshot.content.text : undefined;
}

function workspaceChangeStatus(
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
