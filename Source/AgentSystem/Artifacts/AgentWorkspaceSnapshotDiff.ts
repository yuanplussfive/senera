import type {
  ToolWorkspaceChange,
  ToolWorkspaceFileSnapshot,
  ToolWorkspaceSnapshot,
} from "../Types/ToolRuntimeTypes.js";
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
    };
  });
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
