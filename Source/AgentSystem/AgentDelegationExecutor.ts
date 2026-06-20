import type { AgentEventSink } from "./AgentEvent.js";
import { throwIfAborted } from "./AgentCancellation.js";
import {
  AgentChildAgentRuntime,
  type AgentChildAgentRunResult,
} from "./AgentChildAgentRuntime.js";
import type {
  AgentDelegationJob,
  AgentDelegationPlan,
} from "./AgentDelegationPlan.js";

export interface AgentDelegationExecutorOptions {
  childRuntime: AgentChildAgentRuntime;
}

export interface AgentDelegationRunInput {
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

export interface AgentDelegationRunResult {
  workflowName: string;
  status: "completed";
  mode:
    | "sequentialDirectModel"
    | "sequentialAgentLoop"
    | "sequentialMixed"
    | "parallelDirectModel"
    | "parallelAgentLoop"
    | "parallelMixed";
  schedule: AgentDelegationPlan["schedule"];
  jobs: {
    item: AgentChildAgentRunResult[];
  };
  completedCount: number;
}

export class AgentDelegationExecutor {
  constructor(private readonly options: AgentDelegationExecutorOptions) {}

  async run(input: AgentDelegationRunInput): Promise<AgentDelegationRunResult> {
    const jobs = input.jobs ?? input.plan.jobs.item;
    const runJob = async (job: AgentDelegationJob) => {
      throwIfAborted(input.signal);
      return this.options.childRuntime.runJob({
        requestId: input.requestId,
        step: input.step,
        plan: input.plan,
        job,
        latestUserRequest: input.latestUserRequest,
        evidenceRefs: input.evidenceRefs,
        artifactUris: input.artifactUris,
        onEvent: input.onEvent,
        signal: input.signal,
      });
    };
    const results = input.plan.schedule.strategy === "parallel"
      ? await this.runParallel(jobs, input.plan.schedule.maxConcurrency, runJob, input.signal)
      : await this.runSequential(jobs, runJob, input.signal);

    return {
      workflowName: input.plan.workflow.name,
      status: "completed",
      mode: this.resolveMode(results, input.plan.schedule.strategy),
      schedule: input.plan.schedule,
      jobs: {
        item: results,
      },
      completedCount: results.length,
    };
  }

  private async runSequential(
    jobs: readonly AgentDelegationJob[],
    runJob: (job: AgentDelegationJob) => Promise<AgentChildAgentRunResult>,
    signal?: AbortSignal,
  ): Promise<AgentChildAgentRunResult[]> {
    const results: AgentChildAgentRunResult[] = [];
    for (const job of jobs) {
      throwIfAborted(signal);
      results.push(await runJob(job));
    }
    return results;
  }

  private async runParallel(
    jobs: readonly AgentDelegationJob[],
    maxConcurrency: number | undefined,
    runJob: (job: AgentDelegationJob) => Promise<AgentChildAgentRunResult>,
    signal?: AbortSignal,
  ): Promise<AgentChildAgentRunResult[]> {
    const concurrency = Math.min(maxConcurrency ?? jobs.length, jobs.length);
    const results = new Array<AgentChildAgentRunResult>(jobs.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < jobs.length) {
        throwIfAborted(signal);
        const index = nextIndex;
        nextIndex += 1;
        const job = jobs[index];
        if (!job) {
          continue;
        }
        results[index] = await runJob(job);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return results;
  }

  private resolveMode(
    results: readonly AgentChildAgentRunResult[],
    strategy: AgentDelegationPlan["schedule"]["strategy"],
  ): AgentDelegationRunResult["mode"] {
    const modes = new Set(results.map((result) => result.mode));
    if (modes.size === 1 && modes.has("directModel")) {
      return strategy === "parallel" ? "parallelDirectModel" : "sequentialDirectModel";
    }
    if (modes.size === 1 && modes.has("agentLoop")) {
      return strategy === "parallel" ? "parallelAgentLoop" : "sequentialAgentLoop";
    }
    return strategy === "parallel" ? "parallelMixed" : "sequentialMixed";
  }
}
