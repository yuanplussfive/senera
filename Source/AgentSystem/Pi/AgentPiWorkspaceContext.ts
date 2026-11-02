import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentResourceReferenceOrigins } from "../Resources/AgentResourceReference.js";
import { isAgentToolResultSourceView, type ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { AgentPiSessionCustomEntryTypes } from "./AgentPiSessionEntries.js";
import { parseAgentPiToolDetails } from "./AgentPiToolResultDetails.js";
import type {
  AgentPiWorkspaceToolContext,
  AgentPiWorkspaceTransition,
  AgentPiWorkspaceTurnContext,
} from "./AgentPiWorkspaceContextTypes.js";

/** Written with the ordinary Pi tool result, including failed/partial executions. */
export function projectAgentPiWorkspaceToolContext(result: ExecutedToolCallResult): AgentPiWorkspaceToolContext {
  if (isAgentToolResultSourceView(result)) return { version: 1, outputs: [] };
  const capture = result.artifact?.workspace ?? result.workspaceCapture;
  const changes = capture?.changes.map(({ absolutePath: _absolutePath, patch: _patch, ...change }) => change);
  const warnings = new Set([...(capture?.before.warnings ?? []), ...(capture?.after.warnings ?? [])]);
  return {
    version: 1,
    ...(capture
      ? {
          capture: {
            id: sha256HexOfCanonicalJson({
              before: capture.before.capturedAt,
              after: capture.after.capturedAt,
              scope: capture.scope,
              changes,
            }),
            ...(capture.source ? { source: capture.source } : {}),
            ...(capture.sources ? { sources: [...capture.sources] } : {}),
            ...(capture.coverage ? { coverage: capture.coverage } : {}),
            ...(capture.status ? { quality: capture.status } : {}),
            ...(warnings.size > 0 ? { warningCount: warnings.size } : {}),
            ...(capture.scope ? { scope: capture.scope } : {}),
            changes: changes ?? [],
          },
        }
      : {}),
    outputs: (result.presentation?.resources ?? []).filter(
      (resource) =>
        resource.origin !== AgentResourceReferenceOrigins.Upload &&
        resource.origin !== AgentResourceReferenceOrigins.Remote,
    ),
  };
}

/** Walk only the latest turn, using Pi's indexed entries instead of replaying the whole branch. */
export function readAgentPiWorkspaceTurnContext(
  manager: Pick<SessionManager, "getLeafId" | "getEntry">,
): AgentPiWorkspaceTurnContext | undefined {
  const entries: SessionEntry[] = [];
  let id = manager.getLeafId();
  while (id) {
    const entry = manager.getEntry(id);
    if (!entry) break;
    entries.push(entry);
    if (entry.type === "custom" && entry.customType === AgentPiSessionCustomEntryTypes.TurnBoundary) break;
    id = entry.parentId;
  }
  return projectAgentPiWorkspaceTurnContext(entries.reverse());
}

/** Compaction preserves the underlying entries; rewind/fork select their own ancestry. */
export function projectAgentPiWorkspaceTurnContext(
  entries: readonly SessionEntry[],
): AgentPiWorkspaceTurnContext | undefined {
  let boundary = entries.length - 1;
  while (boundary >= 0) {
    const entry = entries[boundary];
    if (entry?.type === "custom" && entry.customType === AgentPiSessionCustomEntryTypes.TurnBoundary) break;
    boundary -= 1;
  }
  if (boundary < 0) return undefined;
  const captures = new Map<string, AgentPiWorkspaceTurnContext["captures"][number]>();
  const changes = new Map<string, AgentPiWorkspaceTurnContext["changes"][number][]>();
  const outputs = new Map<string, AgentPiWorkspaceToolContext["outputs"][number]>();
  let unavailableResults = 0;
  for (const entry of entries.slice(boundary + 1)) {
    if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
    const details = parseAgentPiToolDetails(entry.message.details)?.senera;
    const context = details?.workspaceContext;
    if (!context) {
      unavailableResults += 1;
      continue;
    }
    for (const output of context.outputs) outputs.set(output.uri, output);
    const capture = context.capture;
    if (!capture) continue;
    const previous = captures.get(capture.id);
    const detail = details?.artifactUri;
    const refs = [...new Set([...(previous?.details ?? []), ...(detail ? [detail] : [])])];
    const { changes: transitions, ...metadata } = capture;
    captures.set(capture.id, { ...metadata, details: refs });
    // The same batch observation can be attached to more than one tool result.
    if (previous) continue;
    for (const transition of transitions) appendTransition(changes, transition, capture.id);
  }
  const netChanges = [...changes.values()].flat().filter((change) => !sameVersion(change, "before", change, "after"));
  if (captures.size === 0 && outputs.size === 0 && unavailableResults === 0) return undefined;
  return {
    scope: "previous-turn",
    captures: [...captures.values()],
    changes: netChanges,
    outputs: [...outputs.values()],
    unavailableResults,
  };
}

function appendTransition(
  files: Map<string, AgentPiWorkspaceTurnContext["changes"][number][]>,
  next: AgentPiWorkspaceTransition,
  captureId: string,
): void {
  if (next.status === "unchanged") return;
  const segments = files.get(next.path) ?? [];
  const previous = segments.at(-1);
  if (previous && sameVersion(previous, "after", next, "before")) {
    // Summing patch line counts would describe edit activity, not a net diff.
    const { addedLines: _added, removedLines: _removed, ...merged } = previous;
    segments[segments.length - 1] = {
      ...merged,
      afterKind: next.afterKind,
      afterHash: next.afterHash,
      afterSize: next.afterSize,
      status: netStatus(previous, next),
      captures: [...previous.captures, captureId],
    };
  } else {
    segments.push({
      ...next,
      captures: [captureId],
      continuity: segments.length === 0 ? "verified" : "unverified",
    });
  }
  files.set(next.path, segments);
}

function sameVersion(
  left: AgentPiWorkspaceTransition,
  leftSide: "before" | "after",
  right: AgentPiWorkspaceTransition,
  rightSide: "before" | "after",
): boolean {
  const kind = left[`${leftSide}Kind`];
  if (kind !== right[`${rightSide}Kind`]) return false;
  if (kind === "missing") return true;
  const hash = left[`${leftSide}Hash`];
  return hash.length > 0 && hash === right[`${rightSide}Hash`];
}

function netStatus(
  first: AgentPiWorkspaceTransition,
  last: AgentPiWorkspaceTransition,
): AgentPiWorkspaceTransition["status"] {
  if (first.beforeKind === "missing") return "added";
  if (last.afterKind === "missing") return "deleted";
  return first.beforeKind === last.afterKind ? "modified" : "type_changed";
}
