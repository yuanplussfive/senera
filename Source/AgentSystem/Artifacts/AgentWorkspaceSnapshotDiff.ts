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

  return [...paths].sort().map((filePath) => {
    const left =
      beforeByPath.get(filePath) ?? missingWorkspaceSnapshot(filePath, afterByPath.get(filePath)?.absolutePath ?? "");
    const right = afterByPath.get(filePath) ?? missingWorkspaceSnapshot(filePath, left.absolutePath);
    const lineChanges = projectLineChanges(left, right);
    return {
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
    };
  });
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
