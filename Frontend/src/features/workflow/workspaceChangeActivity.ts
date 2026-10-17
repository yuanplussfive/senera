import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { isTextFilePreview } from "../../lib/filePreview";
import type { ToolResultPresentationChange } from "../../api/eventTypes";

export type WorkspaceChangeStatus = NonNullable<ToolResultPresentationChange["workspaceStatus"]>;

export interface WorkspaceFileActivityRow {
  readonly label: string;
  readonly action: string;
  readonly path: string;
  readonly status: WorkspaceChangeStatus;
  readonly addedLines?: number;
  readonly removedLines?: number;
}

export interface WorkspaceFileActivitySummary {
  readonly label: string;
  readonly accessibleLabel: string;
  readonly fileCount: number;
  readonly directoryCount: number;
  readonly addedLines?: number;
  readonly removedLines?: number;
}

/**
 * Presentation rows are intentionally file-only. Directory entries remain in
 * the workspace capture for recovery and audit, but they are not artifacts and
 * must not inflate file counts or line deltas.
 *
 * Older persisted presentations do not carry entry kinds. Those rows retain
 * the historical file projection until a richer workspace record is available;
 * new records always carry both snapshot kinds from the backend.
 */
export function isWorkspaceFileChange(change: ToolResultPresentationChange): boolean {
  if (change.workspaceBeforeKind === undefined && change.workspaceAfterKind === undefined) return true;
  return change.workspaceBeforeKind === "file" || change.workspaceAfterKind === "file";
}

export function isWorkspaceDirectoryChange(change: ToolResultPresentationChange): boolean {
  if (change.workspaceBeforeKind === undefined && change.workspaceAfterKind === undefined) return false;
  return (
    !isWorkspaceFileChange(change) &&
    (change.workspaceBeforeKind === "directory" || change.workspaceAfterKind === "directory")
  );
}

/** Only text-like workspace files have meaningful line-level hover previews. */
export function isWorkspaceTextChange(change: ToolResultPresentationChange): boolean {
  return isWorkspaceFileChange(change) && isTextFilePreview({ name: change.key });
}

const WorkspaceStatusMessageKeys = {
  added: "workflow.workspace.status.added",
  deleted: "workflow.workspace.status.deleted",
  modified: "workflow.workspace.status.modified",
  type_changed: "workflow.workspace.status.typeChanged",
  unchanged: "workflow.workspace.status.unchanged",
} as const satisfies Record<WorkspaceChangeStatus, Parameters<typeof frontendMessage>[0]>;

export function projectWorkspaceFileActivityRows(
  changes: readonly ToolResultPresentationChange[] | undefined,
): WorkspaceFileActivityRow[] {
  return (changes ?? []).flatMap((change) => {
    if (change.kind !== "workspace" || !change.key.trim()) return [];
    if (!isWorkspaceFileChange(change)) return [];
    const status = resolveWorkspaceChangeStatus(change);
    if (status === "unchanged") return [];

    const action = workspaceChangeStatusLabel(status);
    const path = change.key.trim();
    const addedLines = readLineCount(change.addedLines);
    const removedLines = readLineCount(change.removedLines);
    const label = [action, fileName(path), formatWorkspaceLineDelta(addedLines, removedLines)]
      .filter(Boolean)
      .join(" ");

    return [
      {
        label,
        action,
        path,
        status,
        ...(addedLines === undefined ? {} : { addedLines }),
        ...(removedLines === undefined ? {} : { removedLines }),
      },
    ];
  });
}

export function summarizeWorkspaceFileActivity(
  rows: readonly WorkspaceFileActivityRow[],
  changes: readonly ToolResultPresentationChange[] = [],
): WorkspaceFileActivitySummary | undefined {
  const directoryChanges = changes.filter(isVisibleWorkspaceDirectoryChange);
  if (rows.length === 0 && directoryChanges.length === 0) return undefined;

  const actions = new Set([
    ...rows.map((row) => row.action),
    ...directoryChanges.map((change) => workspaceChangeStatusLabel(resolveWorkspaceChangeStatus(change))),
  ]);
  const action = actions.size === 1 ? [...actions][0]! : frontendMessage("workflow.workspace.status.changed");
  const fileCount = rows.length;
  const directoryCount = directoryChanges.length;
  const label = formatWorkspaceChangeSummary({ action, fileCount, directoryCount, rows });
  const hasCompleteLineCounts =
    rows.length > 0 && rows.every((row) => row.addedLines !== undefined && row.removedLines !== undefined);
  const addedLines = hasCompleteLineCounts ? rows.reduce((total, row) => total + (row.addedLines ?? 0), 0) : undefined;
  const removedLines = hasCompleteLineCounts
    ? rows.reduce((total, row) => total + (row.removedLines ?? 0), 0)
    : undefined;
  const delta = formatWorkspaceLineDelta(addedLines, removedLines);

  return {
    label,
    accessibleLabel: [label, delta].filter(Boolean).join(" "),
    fileCount,
    directoryCount,
    ...(addedLines === undefined ? {} : { addedLines }),
    ...(removedLines === undefined ? {} : { removedLines }),
  };
}

export function workspaceChangeStatusLabel(status: WorkspaceChangeStatus): string {
  return frontendMessage(WorkspaceStatusMessageKeys[status]);
}

export function formatWorkspaceLineDelta(addedLines?: number, removedLines?: number): string | undefined {
  const added = readLineCount(addedLines);
  const removed = readLineCount(removedLines);
  const parts = [
    added === undefined ? undefined : `+${added}`,
    removed === undefined ? undefined : `\u2212${removed}`,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function resolveWorkspaceChangeStatus(change: ToolResultPresentationChange): WorkspaceChangeStatus {
  if (change.workspaceStatus) return change.workspaceStatus;
  return change.status === "added" ? "added" : change.status === "changed" ? "modified" : "unchanged";
}

function isVisibleWorkspaceDirectoryChange(change: ToolResultPresentationChange): boolean {
  return (
    change.kind === "workspace" &&
    change.status !== "unchanged" &&
    change.workspaceStatus !== "unchanged" &&
    isWorkspaceDirectoryChange(change)
  );
}

function formatWorkspaceChangeSummary(input: {
  action: string;
  fileCount: number;
  directoryCount: number;
  rows: readonly WorkspaceFileActivityRow[];
}): string {
  if (input.directoryCount === 0 && input.fileCount === 1) {
    return [input.action, fileName(input.rows[0]!.path)].filter(Boolean).join(" ");
  }

  const countLabel =
    input.fileCount > 0 && input.directoryCount > 0
      ? frontendMessage("workflow.run.output.filesAndDirectories", {
          files: input.fileCount,
          directories: input.directoryCount,
        })
      : input.fileCount > 0
        ? frontendMessage("workflow.run.output.files", { count: input.fileCount })
        : frontendMessage("workflow.run.output.directories", { count: input.directoryCount });
  return [input.action, countLabel].filter(Boolean).join(" ");
}

function readLineCount(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.abs(value) : undefined;
}

function fileName(path: string): string {
  const normalized = path.replace(/\\/gu, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || path;
}
