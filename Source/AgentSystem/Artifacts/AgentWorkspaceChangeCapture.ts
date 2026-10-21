import path from "node:path";
import { materializeAgentWorkspaceMutationReceipt } from "./AgentWorkspaceMutationReceipt.js";
import type { ToolArtifactPolicyManifest } from "../Types/AgentToolContractTypes.js";
import type {
  AgentWorkspaceMutationReceipt,
  ToolWorkspaceCaptureResult,
  ToolWorkspaceChangeSource,
  ToolWorkspaceSnapshot,
} from "../Types/ToolRuntimeTypes.js";

export interface AgentWorkspaceChangeCaptureOptions {
  readonly workspaceRoot: string;
}

/**
 * Turns a writer-owned transaction receipt into durable workspace provenance.
 * It deliberately has no watcher, repository, or filesystem discovery path:
 * a tool either proves its own mutation or it does not publish a workspace
 * change set.
 */
export class AgentWorkspaceChangeCapture {
  private readonly workspaceRoot: string;

  constructor(options: AgentWorkspaceChangeCaptureOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
  }

  capture(input: {
    readonly policy: ToolArtifactPolicyManifest | undefined;
    readonly mutationReceipt?: AgentWorkspaceMutationReceipt;
  }): ToolWorkspaceCaptureResult | undefined {
    const workspacePolicy = input.policy?.Workspace;
    if (!workspacePolicy) return undefined;

    return materializeAgentWorkspaceMutationReceipt({
      receipt: input.mutationReceipt,
      workspaceRoot: this.workspaceRoot,
      workspacePolicy,
    });
  }
}

export function mergeAgentWorkspaceCaptures(
  exact: ToolWorkspaceCaptureResult | undefined,
  observed: ToolWorkspaceCaptureResult | undefined,
): ToolWorkspaceCaptureResult | undefined {
  if (!observed) return exact;
  if (!exact) return observed;

  const sources = [...new Set([...captureSources(exact), ...captureSources(observed)])];
  const status = worseCaptureStatus(exact.status, observed.status);
  return {
    type: observed.type ?? exact.type,
    version: observed.version ?? exact.version,
    source: "filesystem-observer",
    sources,
    coverage: "observed",
    status,
    scope: observed.scope,
    before: mergeWorkspaceSnapshots(exact.before, observed.before, status),
    after: mergeWorkspaceSnapshots(exact.after, observed.after, status),
    changes: [...new Map([...exact.changes, ...observed.changes].map((change) => [change.path, change])).values()].sort(
      (left, right) => left.path.localeCompare(right.path),
    ),
  };
}

function captureSources(capture: ToolWorkspaceCaptureResult): ToolWorkspaceChangeSource[] {
  return [...(capture.sources ?? []), ...(capture.source ? [capture.source] : [])];
}

function worseCaptureStatus(
  left: ToolWorkspaceCaptureResult["status"],
  right: ToolWorkspaceCaptureResult["status"],
): ToolWorkspaceCaptureResult["status"] {
  const rank = { complete: 0, bounded: 1, degraded: 2 } as const;
  if (!left) return right;
  if (!right) return left;
  return rank[left] >= rank[right] ? left : right;
}

function mergeWorkspaceSnapshots(
  exact: ToolWorkspaceSnapshot,
  observed: ToolWorkspaceSnapshot,
  status: ToolWorkspaceSnapshot["status"],
): ToolWorkspaceSnapshot {
  const files = new Map(exact.files.map((entry) => [entry.path, entry]));
  for (const entry of observed.files) if (!files.has(entry.path)) files.set(entry.path, entry);
  const warnings = [...new Set([...(exact.warnings ?? []), ...(observed.warnings ?? [])])];
  return {
    files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)),
    capturedAt: observed.capturedAt,
    ...(status ? { status } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
