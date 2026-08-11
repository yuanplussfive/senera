import { z } from "zod";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import { AgentChildWorkspaceAccessModes } from "./AgentChildRunTypes.js";
import { AgentRunContextModes } from "./AgentRunDispatchPort.js";

export const AgentWorkflowDefinitionVersion = 1 as const;

export const AgentWorkflowStatuses = {
  Queued: "queued",
  Running: "running",
  Paused: "paused",
  Completed: "completed",
  PartialCompleted: "partial_completed",
  Failed: "failed",
  Cancelling: "cancelling",
  Cancelled: "cancelled",
} as const;

export type AgentWorkflowStatus = (typeof AgentWorkflowStatuses)[keyof typeof AgentWorkflowStatuses];

export const AgentWorkflowNodeStatuses = {
  Pending: "pending",
  Running: "running",
  Paused: "paused",
  Completed: "completed",
  PartialCompleted: "partial_completed",
  Failed: "failed",
  Skipped: "skipped",
  Cancelled: "cancelled",
} as const;

export type AgentWorkflowNodeStatus = (typeof AgentWorkflowNodeStatuses)[keyof typeof AgentWorkflowNodeStatuses];

export const AgentWorkflowFailurePolicies = {
  FailFast: "fail_fast",
  ContinueIndependent: "continue_independent",
} as const;

export type AgentWorkflowFailurePolicy =
  (typeof AgentWorkflowFailurePolicies)[keyof typeof AgentWorkflowFailurePolicies];

export const AgentWorkflowHandoffModes = {
  TaskOnly: "task_only",
  AppendDependencyResults: "append_dependency_results",
} as const;

const NonEmptyString = z.string().trim().min(1);
const ThinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export const AgentWorkflowNodeDefinitionSchema = z
  .object({
    id: NonEmptyString,
    agent: NonEmptyString,
    task: NonEmptyString,
    dependsOn: z.array(NonEmptyString).default([]),
    handoff: z.enum(AgentWorkflowHandoffModes).default(AgentWorkflowHandoffModes.AppendDependencyResults),
    workspaceAccess: z.enum(AgentChildWorkspaceAccessModes),
    context: z.enum(AgentRunContextModes).optional(),
    modelProviderId: NonEmptyString.optional(),
    skills: z.array(NonEmptyString).optional(),
    thinking: ThinkingLevelSchema.optional(),
  })
  .strict();

export type AgentWorkflowNodeDefinition = z.infer<typeof AgentWorkflowNodeDefinitionSchema>;

export const AgentWorkflowDefinitionSchema = z
  .object({
    version: z.literal(AgentWorkflowDefinitionVersion).default(AgentWorkflowDefinitionVersion),
    failurePolicy: z.enum(AgentWorkflowFailurePolicies).default(AgentWorkflowFailurePolicies.FailFast),
    nodes: z.array(AgentWorkflowNodeDefinitionSchema).min(1),
  })
  .strict()
  .superRefine((definition, context) => {
    const ids = new Set<string>();
    for (const [index, node] of definition.nodes.entries()) {
      if (ids.has(node.id)) {
        context.addIssue({ code: "custom", path: ["nodes", index, "id"], message: `Duplicate node id '${node.id}'.` });
      }
      ids.add(node.id);
      if (new Set(node.dependsOn).size !== node.dependsOn.length) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "dependsOn"],
          message: `Node '${node.id}' contains duplicate dependencies.`,
        });
      }
      if (node.dependsOn.includes(node.id)) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "dependsOn"],
          message: `Node '${node.id}' cannot depend on itself.`,
        });
      }
    }
    for (const [index, node] of definition.nodes.entries()) {
      for (const dependency of node.dependsOn) {
        if (!ids.has(dependency)) {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, "dependsOn"],
            message: `Node '${node.id}' references unknown dependency '${dependency}'.`,
          });
        }
      }
    }
  });

export type AgentWorkflowDefinition = z.infer<typeof AgentWorkflowDefinitionSchema>;

export interface AgentWorkflowNodeRecord {
  readonly workflowId: string;
  readonly nodeId: string;
  readonly status: AgentWorkflowNodeStatus;
  readonly childRunId?: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface AgentWorkflowRecord {
  readonly id: string;
  readonly parentSessionId: string;
  readonly parentRequestId: string;
  readonly approvalMode: AgentExecutionApprovalMode;
  readonly definitionDigest: string;
  readonly definition: AgentWorkflowDefinition;
  readonly status: AgentWorkflowStatus;
  readonly nodes: readonly AgentWorkflowNodeRecord[];
  readonly error?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface AgentWorkflowNodeResult {
  readonly nodeId: string;
  readonly status: AgentWorkflowNodeStatus;
  readonly childRunId?: string;
  readonly finalAnswer?: string;
  readonly error?: string;
}

export interface AgentWorkflowResult {
  readonly workflow: AgentWorkflowRecord | null;
  readonly results: readonly AgentWorkflowNodeResult[];
}

export interface AgentWorkflowCreateInput {
  readonly id: string;
  readonly parentSessionId: string;
  readonly parentRequestId: string;
  readonly approvalMode: AgentExecutionApprovalMode;
  readonly definitionDigest: string;
  readonly definition: AgentWorkflowDefinition;
}

export interface AgentWorkflowRepository {
  create(input: AgentWorkflowCreateInput, createdAt?: string): AgentWorkflowRecord;
  get(id: string): AgentWorkflowRecord | undefined;
  listForParent(parentSessionId: string, parentRequestId?: string): AgentWorkflowRecord[];
  markRunning(id: string, updatedAt?: string): AgentWorkflowRecord | undefined;
  markPaused(id: string, error: string | undefined, updatedAt?: string): AgentWorkflowRecord | undefined;
  markCompleted(id: string, partial: boolean, updatedAt?: string): AgentWorkflowRecord | undefined;
  markFailed(id: string, error: string, updatedAt?: string): AgentWorkflowRecord | undefined;
  markCancelling(id: string, updatedAt?: string): AgentWorkflowRecord | undefined;
  markCancelled(id: string, updatedAt?: string): AgentWorkflowRecord | undefined;
  markNodeRunning(id: string, nodeId: string, childRunId: string, updatedAt?: string): AgentWorkflowRecord | undefined;
  markNodeTerminal(
    id: string,
    nodeId: string,
    status: Exclude<AgentWorkflowNodeStatus, "pending" | "running">,
    error?: string,
    updatedAt?: string,
  ): AgentWorkflowRecord | undefined;
  resetForResume(id: string, updatedAt?: string): AgentWorkflowRecord | undefined;
  recoverInterrupted(error: string, updatedAt?: string): number;
}

export function parseAgentWorkflowDefinition(value: unknown): AgentWorkflowDefinition {
  const definition = AgentWorkflowDefinitionSchema.parse(value);
  assertAcyclicWorkflow(definition);
  return definition;
}

export function assertAcyclicWorkflow(definition: AgentWorkflowDefinition): void {
  const remainingDependencies = new Map(definition.nodes.map((node) => [node.id, new Set(node.dependsOn)] as const));
  const ready = definition.nodes.filter((node) => node.dependsOn.length === 0).map((node) => node.id);
  let visited = 0;
  while (ready.length > 0) {
    const completed = ready.shift()!;
    visited += 1;
    for (const [nodeId, dependencies] of remainingDependencies) {
      if (!dependencies.delete(completed) || dependencies.size > 0) continue;
      if (nodeId !== completed) ready.push(nodeId);
    }
    remainingDependencies.delete(completed);
  }
  if (visited === definition.nodes.length) return;
  const cycle = [...remainingDependencies.keys()].sort((left, right) => left.localeCompare(right));
  throw new Error(`Subagent workflow contains a dependency cycle involving: ${cycle.join(", ")}.`);
}
