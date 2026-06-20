import type { AgentEventSink } from "./AgentEvent.js";
import {
  AgentDelegationExecutor,
  type AgentDelegationRunResult,
} from "./AgentDelegationExecutor.js";
import type { AgentMergePolicyRunResult } from "./AgentMergePolicyExecutor.js";
import { AgentMergePolicyExecutor } from "./AgentMergePolicyExecutor.js";
import type {
  AgentDelegationJob,
  AgentDelegationPlan,
} from "./AgentDelegationPlan.js";

export interface AgentDelegationWorkflowRunnerOptions {
  delegationExecutor: AgentDelegationExecutor;
  mergeExecutor: AgentMergePolicyExecutor;
}

export interface AgentDelegationWorkflowRunInput {
  requestId: string;
  step: number;
  plan: AgentDelegationPlan;
  latestUserRequest: string;
  jobs?: readonly AgentDelegationJob[];
  evidenceRefs?: readonly string[];
  artifactUris?: readonly string[];
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
}

export interface AgentDelegationWorkflowRunResult {
  workflowName: string;
  status: "completed";
  mode:
    | "sequentialDirectModelWithMerge"
    | "sequentialAgentLoopWithMerge"
    | "sequentialMixedWithMerge"
    | "parallelDirectModelWithMerge"
    | "parallelAgentLoopWithMerge"
    | "parallelMixedWithMerge";
  delegation: AgentDelegationRunResult;
  merge: AgentMergePolicyRunResult;
}

export class AgentDelegationWorkflowRunner {
  constructor(private readonly options: AgentDelegationWorkflowRunnerOptions) {}

  async run(input: AgentDelegationWorkflowRunInput): Promise<AgentDelegationWorkflowRunResult> {
    const delegation = await this.options.delegationExecutor.run(input);
    const merge = await this.options.mergeExecutor.run({
      requestId: input.requestId,
      step: input.step,
      plan: input.plan,
      childResults: delegation.jobs.item,
      onEvent: input.onEvent,
      signal: input.signal,
    });

    return {
      workflowName: input.plan.workflow.name,
      status: "completed",
      mode: this.resolveMode(delegation),
      delegation,
      merge,
    };
  }

  private resolveMode(
    delegation: AgentDelegationRunResult,
  ): AgentDelegationWorkflowRunResult["mode"] {
    if (delegation.mode === "sequentialDirectModel") {
      return "sequentialDirectModelWithMerge";
    }
    if (delegation.mode === "sequentialAgentLoop") {
      return "sequentialAgentLoopWithMerge";
    }
    if (delegation.mode === "sequentialMixed") {
      return "sequentialMixedWithMerge";
    }
    if (delegation.mode === "parallelDirectModel") {
      return "parallelDirectModelWithMerge";
    }
    if (delegation.mode === "parallelAgentLoop") {
      return "parallelAgentLoopWithMerge";
    }
    return "parallelMixedWithMerge";
  }
}
