import type { ToolResultPresentation } from "../../api/eventTypes";
import type { TimelineStep } from "../../store/sessionStore";
import { isWorkspaceDirectoryChange, isWorkspaceFileChange } from "./workspaceChangeActivity";

export type ToolResource = NonNullable<ToolResultPresentation["resources"]>[number];
export type ToolWorkspaceChange = ToolResultPresentation["changes"][number];
export type ToolWorkspaceObservation = NonNullable<ToolResultPresentation["workspaceObservation"]>;

export interface ToolWorkspaceChangeSummary {
  readonly fileCount: number;
  readonly directoryCount: number;
  readonly addedFiles: number;
  readonly deletedFiles: number;
  readonly modifiedFiles: number;
  readonly addedDirectories: number;
  readonly deletedDirectories: number;
  readonly modifiedDirectories: number;
  readonly addedLines: number;
  readonly removedLines: number;
}

/**
 * Projects all resources produced during a run into one stable gallery input.
 * The URI is the resource identity; lifecycle events and tool steps may repeat
 * the same reference, so the projection merges later non-empty metadata while
 * keeping the URI as the stable identity.
 */
export function collectToolResources(steps: readonly TimelineStep[]): readonly ToolResource[] {
  const resources = new Map<string, ToolResource>();
  for (const step of steps) {
    for (const resource of step.toolPresentation?.resources ?? []) {
      if (!resource.uri) continue;
      resources.set(resource.uri, mergeResource(resources.get(resource.uri), resource));
    }
  }
  return [...resources.values()];
}

function mergeResource(previous: ToolResource | undefined, next: ToolResource): ToolResource {
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    name: next.name || previous.name,
    mime: next.mime || previous.mime,
    ...(next.size === undefined && previous.size !== undefined ? { size: previous.size } : {}),
    ...(next.sha256 === undefined && previous.sha256 !== undefined ? { sha256: previous.sha256 } : {}),
  };
}

/** Projects workspace mutations separately from media so file actions remain
 * inspectable without pretending that a changed file is a downloadable asset. */
export function collectToolWorkspaceChanges(steps: readonly TimelineStep[]): readonly ToolWorkspaceChange[] {
  const changes = new Map<string, ToolWorkspaceChange>();
  for (const step of steps) {
    for (const change of step.toolPresentation?.changes ?? []) {
      if (
        change.kind !== "workspace" ||
        !change.key ||
        change.status === "unchanged" ||
        change.workspaceStatus === "unchanged"
      ) {
        continue;
      }
      const merged = mergeWorkspaceChange(changes.get(change.key), change);
      if (merged) changes.set(change.key, merged);
      else changes.delete(change.key);
    }
  }
  return [...changes.values()];
}

export function collectToolWorkspaceObservation(steps: readonly TimelineStep[]): ToolWorkspaceObservation | undefined {
  const observations = steps.flatMap((step) =>
    step.toolPresentation?.workspaceObservation ? [step.toolPresentation.workspaceObservation] : [],
  );
  if (observations.length === 0) return undefined;

  const warnings = [...new Set(observations.flatMap((observation) => observation.warnings ?? []))];
  const changes = collectToolWorkspaceChanges(steps);
  const first = observations[0]!;
  const last = observations[observations.length - 1]!;
  const qualities = observations.map((observation) => observation.quality).filter(Boolean);
  const quality = qualities.includes("degraded") ? "degraded" : qualities.includes("bounded") ? "bounded" : undefined;
  const sources = [
    ...new Set(
      observations.flatMap((observation) => [
        ...(observation.sources ?? []),
        ...(observation.source ? [observation.source] : []),
      ]),
    ),
  ];
  const scope = readSharedWorkspaceScope(observations.map((observation) => observation.scope));
  const changeSummary = summarizeToolWorkspaceChanges(changes);
  return {
    status: observations.some((observation) => observation.status === "partial") ? "partial" : "complete",
    ...(quality ? { quality } : {}),
    ...(observations.some((observation) => observation.coverage === "observed")
      ? { coverage: "observed" as const }
      : observations.some((observation) => observation.coverage === "exact")
        ? { coverage: "exact" as const }
        : {}),
    ...(sources.length > 0 ? { sources } : {}),
    ...(scope ? { scope } : {}),
    beforeEntryCount: first.beforeEntryCount,
    afterEntryCount: last.afterEntryCount,
    changedFileCount: changeSummary.fileCount,
    changedDirectoryCount: changeSummary.directoryCount,
    warningCount: warnings.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export function summarizeToolWorkspaceChanges(changes: readonly ToolWorkspaceChange[]): ToolWorkspaceChangeSummary {
  return changes.reduce<ToolWorkspaceChangeSummary>(
    (summary, change) => {
      const status = change.workspaceStatus ?? "modified";
      if (isWorkspaceDirectoryChange(change)) {
        return {
          ...summary,
          directoryCount: summary.directoryCount + 1,
          addedDirectories: summary.addedDirectories + (status === "added" ? 1 : 0),
          deletedDirectories: summary.deletedDirectories + (status === "deleted" ? 1 : 0),
          modifiedDirectories:
            summary.modifiedDirectories + (status === "modified" || status === "type_changed" ? 1 : 0),
        };
      }
      if (!isWorkspaceFileChange(change)) return summary;
      return {
        ...summary,
        fileCount: summary.fileCount + 1,
        addedFiles: summary.addedFiles + (status === "added" ? 1 : 0),
        deletedFiles: summary.deletedFiles + (status === "deleted" ? 1 : 0),
        modifiedFiles: summary.modifiedFiles + (status === "modified" || status === "type_changed" ? 1 : 0),
        addedLines: summary.addedLines + (change.addedLines ?? 0),
        removedLines: summary.removedLines + (change.removedLines ?? 0),
      };
    },
    {
      fileCount: 0,
      directoryCount: 0,
      addedFiles: 0,
      deletedFiles: 0,
      modifiedFiles: 0,
      addedDirectories: 0,
      deletedDirectories: 0,
      modifiedDirectories: 0,
      addedLines: 0,
      removedLines: 0,
    },
  );
}

function readSharedWorkspaceScope(
  scopes: readonly (ToolWorkspaceObservation["scope"] | undefined)[],
): ToolWorkspaceObservation["scope"] | undefined {
  const defined = scopes.filter((scope): scope is NonNullable<ToolWorkspaceObservation["scope"]> => Boolean(scope));
  const first = defined[0];
  return first && defined.every((scope) => scope.kind === first.kind && scope.id === first.id) ? first : undefined;
}

function mergeWorkspaceChange(
  previous: ToolWorkspaceChange | undefined,
  next: ToolWorkspaceChange,
): ToolWorkspaceChange | undefined {
  if (!previous) return next;

  const status = mergeWorkspaceStatus(previous.workspaceStatus ?? "modified", next.workspaceStatus ?? "modified");
  if (!status) return undefined;

  return {
    ...previous,
    ...next,
    status: "changed",
    workspaceStatus: status,
    summary: next.summary || previous.summary,
    addedLines: sumLineCounts(previous.addedLines, next.addedLines),
    removedLines: sumLineCounts(previous.removedLines, next.removedLines),
  };
}

function mergeWorkspaceStatus(
  previous: NonNullable<ToolWorkspaceChange["workspaceStatus"]>,
  next: NonNullable<ToolWorkspaceChange["workspaceStatus"]>,
): ToolWorkspaceChange["workspaceStatus"] | undefined {
  if (previous === "unchanged") return next;
  if (next === "unchanged") return previous;
  if (previous === "added") return next === "deleted" ? undefined : "added";
  if (previous === "deleted") return next === "added" ? "modified" : "deleted";
  if (previous === "type_changed" || next === "type_changed") return "type_changed";
  return next;
}

function sumLineCounts(previous: number | undefined, next: number | undefined): number | undefined {
  if (previous === undefined && next === undefined) return undefined;
  return (previous ?? 0) + (next ?? 0);
}
