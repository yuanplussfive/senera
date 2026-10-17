import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentToolResourceClaimDeclaration } from "../ToolRuntime/AgentToolResourceClaimTypes.js";

/**
 * The logical identity of delegated work is separate from a child-run id.
 * Child-run ids identify one execution; this identity survives retries and
 * lets the host converge duplicate submissions on the same parent session.
 */
export interface AgentWorkItemIdentityInput {
  readonly task: string;
  readonly agent: string;
  readonly context?: string;
  readonly workspaceAccess: string;
  readonly forkContext?: boolean;
  readonly skills?: readonly string[];
  readonly thinking?: string;
  readonly ownerRunId?: string;
  readonly nodeId?: string;
  readonly workItemId?: string;
  readonly resources?: readonly AgentToolResourceClaimDeclaration[];
}

export const AgentWorkItemIdentityPrefixes = Object.freeze({
  Explicit: "work",
  WorkflowNode: "node",
  DerivedTask: "task",
});

export function normalizeAgentWorkItemId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function isLegacyAgentTaskDigest(value: string | undefined): boolean {
  return value?.startsWith("legacy:") === true;
}

export function deriveAgentTaskDigest(input: AgentWorkItemIdentityInput): string {
  return sha256HexOfCanonicalJson({
    task: input.task.trim(),
    agent: input.agent.trim(),
    ...(input.context ? { context: input.context } : {}),
    workspaceAccess: input.workspaceAccess,
    ...(input.forkContext === undefined ? {} : { forkContext: input.forkContext }),
    ...(input.skills && input.skills.length > 0
      ? { skills: [...input.skills].map((skill) => skill.trim()).sort() }
      : {}),
    ...(input.thinking ? { thinking: input.thinking } : {}),
    ...(input.resources && input.resources.length > 0 ? { resources: input.resources } : {}),
  });
}

export function resolveAgentWorkItemId(
  input: AgentWorkItemIdentityInput,
  taskDigest = deriveAgentTaskDigest(input),
): string {
  const explicit = normalizeAgentWorkItemId(input.workItemId);
  if (explicit) return `${AgentWorkItemIdentityPrefixes.Explicit}:${explicit}`;

  const ownerRunId = normalizeAgentWorkItemId(input.ownerRunId);
  const nodeId = normalizeAgentWorkItemId(input.nodeId);
  if (ownerRunId && nodeId) {
    return `${AgentWorkItemIdentityPrefixes.WorkflowNode}:${ownerRunId}:${nodeId}`;
  }

  return `${AgentWorkItemIdentityPrefixes.DerivedTask}:${taskDigest}`;
}
