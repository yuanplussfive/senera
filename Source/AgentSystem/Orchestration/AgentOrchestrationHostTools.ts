import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { systemToolArguments } from "../SystemTools/AgentSystemToolDefinition.js";
import { AgentSpawnModes, type AgentDelegationService, type AgentSpawnRequest } from "./AgentDelegationService.js";
import { projectAgentChildRunProgress, projectChildRunPublicState } from "./AgentChildRunProjection.js";
import type { AgentBackgroundAgentJob } from "./AgentBackgroundAgentJobs.js";
import type { AgentScheduleRuntime } from "./AgentScheduleRuntime.js";
import type { AgentScheduledTaskRecord } from "./AgentScheduledTaskRunTypes.js";
import { projectAgentExecutionResourceResult } from "../ToolRuntime/AgentExecutionResourceResultProjector.js";
import type { AgentJobRuntime, AgentJobSnapshot } from "./AgentJobRuntime.js";
import type { AgentModelCapabilityKey } from "../Core/AgentModelCapabilityContract.js";

import { AgentOrchestrationToolNames } from "./AgentOrchestrationToolNames.js";
export { AgentOrchestrationToolNames } from "./AgentOrchestrationToolNames.js";

export interface AgentOrchestrationHostRuntime {
  readonly jobs?: AgentJobRuntime;
  readonly delegation: AgentDelegationService;
  readonly schedules: AgentScheduleRuntime;
}

interface ScheduleInput {
  name?: string;
  prompt: string;
  rrule?: string;
  at?: string;
  time_zone?: string;
  target?: "this_session" | "new_once" | "new";
}

export function createAgentOrchestrationHostHandlers(runtime: AgentOrchestrationHostRuntime): {
  readonly subagent: AgentHostToolHandler;
  readonly sendMessage: AgentHostToolHandler;
  readonly listAgents: AgentHostToolHandler;
  readonly listSubagentModels: AgentHostToolHandler;
  readonly interruptAgent: AgentHostToolHandler;
  readonly scheduleCreate: AgentHostToolHandler;
  readonly scheduleList: AgentHostToolHandler;
  readonly scheduleView: AgentHostToolHandler;
  readonly scheduleEdit: AgentHostToolHandler;
  readonly jobList: AgentHostToolHandler;
  readonly jobOutput: AgentHostToolHandler;
  readonly jobKill: AgentHostToolHandler;
} {
  return {
    listSubagentModels: async (args, context) => {
      const input = systemToolArguments<{
        provider_id?: string;
        model_id?: string;
        capabilities?: AgentModelCapabilityKey[];
      }>(args);
      const { sessionId } = requireRunContext(context.sessionId, context.requestId);
      return toolProcessSuccessResult({
        ...runtime.delegation.discoverModels(
          sessionId,
          context.modelProviderId,
          {
            providerId: input.provider_id,
            modelProviderId: input.model_id,
            capabilities: input.capabilities,
          },
          context.authorizedToolNames?.includes(AgentOrchestrationToolNames.Subagent) ?? false,
        ),
        ...(runtime.jobs ? { delivery: runtime.jobs.deliveryPolicy(sessionId) } : {}),
      });
    },
    jobList: async (_args, context) => {
      const { sessionId } = requireRunContext(context.sessionId, context.requestId);
      if (!runtime.jobs) throw new Error("Background jobs are not connected.");
      return toolProcessSuccessResult({
        jobs: runtime.jobs.list(sessionId).map(projectJobSummary),
        delivery: runtime.jobs.deliveryPolicy(sessionId),
      });
    },
    jobOutput: async (args, context) => {
      const input = systemToolArguments<{
        job_id: string;
        cursor?: number;
        wait?: boolean;
        timeout_ms?: number | null;
      }>(args);
      const { sessionId } = requireRunContext(context.sessionId, context.requestId);
      if (!runtime.jobs) throw new Error("Background jobs are not connected.");
      const options = { wait: input.wait, timeoutMs: input.timeout_ms, signal: context.signal };
      const waitBudget = runtime.jobs.outputWaitTimeoutMs(options);
      if (waitBudget > 0 && context.deadline) {
        // Reserve the wait separately from the ordinary tool processing budget.
        context.deadline.extendTo?.(context.deadline.timeoutMs + waitBudget);
      }
      const result = await runtime.jobs.readOutput(input.job_id, sessionId, input.cursor, options, {
        requestId: context.requestId,
        toolCallId: context.toolCallId,
      });
      return toolProcessSuccessResult({
        ...(result.snapshot.kind === "agent"
          ? projectAgentJob(result.snapshot)
          : {
              ...projectAgentExecutionResourceResult(result.snapshot, { fromCursor: input.cursor }),
              ...(result.snapshot.interruption ? { interruption: result.snapshot.interruption } : {}),
            }),
        ...(result.waitReason ? { waitReason: result.waitReason } : {}),
        delivery: runtime.jobs.deliveryPolicy(sessionId),
      });
    },
    jobKill: async (args, context) => {
      const input = systemToolArguments<{ job_id: string }>(args);
      const { sessionId } = requireRunContext(context.sessionId, context.requestId);
      if (!runtime.jobs) throw new Error("Background jobs are not connected.");
      const result = projectJobSummary(
        await runtime.jobs.kill(input.job_id, sessionId, {
          requestId: context.requestId,
          toolCallId: context.toolCallId,
        }),
      );
      return toolProcessSuccessResult({ job_id: result.job_id, state: result.state });
    },
    scheduleCreate: async (args, context) => {
      const input = systemToolArguments<ScheduleInput>(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const task = await runtime.schedules.create(
        {
          name: input.name,
          prompt: input.prompt,
          type: input.at ? "once" : "cron",
          schedule: input.at ?? input.rrule!,
          timeZone: input.time_zone,
          target: input.target,
        },
        {
          ...parent,
          modelProviderId: context.modelProviderId,
          authorizedToolNames: context.authorizedToolNames ?? [],
          registry: context.registry,
        },
      );
      return toolProcessSuccessResult({ schedule: projectScheduleInstruction(task) });
    },
    scheduleList: async (_args, context) => {
      const parent = requireRunContext(context.sessionId, context.requestId);
      return toolProcessSuccessResult({
        schedules: (await runtime.schedules.list(parent.sessionId)).map(projectScheduleInstruction),
      });
    },
    scheduleView: async (args, context) => {
      const { schedule_id, limit, before } = systemToolArguments<{
        schedule_id: string;
        limit?: number;
        before?: string;
      }>(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const view = runtime.schedules.view(schedule_id, parent.sessionId, limit, before);
      return toolProcessSuccessResult({
        schedule: view
          ? {
              ...projectScheduleInstruction(view.task),
              receipts: view.records.map((run) => ({
                receipt_id: run.id,
                scheduled_for: run.scheduledFor,
                state: run.executionStatus,
                delivery_state: run.deliveryStatus,
                ...(run.instructionPrompt !== undefined
                  ? { prompt: run.instructionPrompt }
                  : { instruction_unavailable: true }),
                ...(run.deliveredAt ? { admitted_at: run.deliveredAt } : {}),
                ...(run.error ? { error: run.error } : {}),
              })),
              ...(view.nextBefore ? { next_before: view.nextBefore } : {}),
              receiptMeaning: "instruction_admission",
            }
          : null,
      });
    },
    scheduleEdit: async (args, context) => {
      const input = systemToolArguments<
        Partial<ScheduleInput> & {
          schedule_id: string;
          operation: "update" | "pause" | "resume" | "delete" | "run_now";
        }
      >(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      if (input.operation === "delete")
        return toolProcessSuccessResult({
          deleted: await runtime.schedules.delete(input.schedule_id, parent.sessionId),
        });
      if (input.operation === "run_now") {
        const task = await runtime.schedules.runNow(input.schedule_id, parent.sessionId);
        return toolProcessSuccessResult({ schedule: task ? projectScheduleInstruction(task) : null });
      }
      const task = await runtime.schedules.update(
        input.schedule_id,
        {
          name: input.name,
          prompt: input.prompt,
          timeZone: input.time_zone,
          ...(input.rrule ? { type: "cron", schedule: input.rrule } : {}),
          ...(input.at ? { type: "once", schedule: input.at } : {}),
          ...(input.operation === "pause" ? { enabled: false } : input.operation === "resume" ? { enabled: true } : {}),
        },
        {
          ...parent,
          modelProviderId: context.modelProviderId,
          authorizedToolNames: context.authorizedToolNames ?? [],
          registry: context.registry,
        },
      );
      return toolProcessSuccessResult({ schedule: task ? projectScheduleInstruction(task) : null });
    },
    subagent: async (args, context) => {
      throwIfAborted(context.signal);
      const input = systemToolArguments<{
        description: string;
        prompt: string;
        agent?: string;
        forkContext?: boolean;
        workItemId?: string;
        todo?: string;
        resources?: AgentSpawnRequest["resources"];
        modelProviderId?: AgentSpawnRequest["modelProviderId"];
        thinking?: AgentSpawnRequest["thinking"];
      }>(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const result = await runtime.delegation.spawnWithOutcome(
        {
          task: input.prompt,
          description: input.description,
          modelProviderId: input.modelProviderId,
          thinking: input.thinking,
          agent: input.agent,
          forkContext: input.forkContext,
          workItemId: input.workItemId,
          todo: input.todo,
          resources: input.resources,
          mode: AgentSpawnModes.Background,
        },
        createDelegationContext(context, parent),
      );
      return toolProcessSuccessResult({
        agent_id: result.run.childSessionId,
        job_id: result.run.childRequestId,
        parent_id: parent.sessionId,
        description: input.description,
        status: result.run.status,
        ...(runtime.jobs ? { delivery: runtime.jobs.deliveryPolicy(parent.sessionId) } : {}),
      });
    },
    sendMessage: async (args, context) => {
      throwIfAborted(context.signal);
      const input = systemToolArguments<{ agent_id: string; message: string }>(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const receipt = await runtime.delegation.sendMessage(
        input.agent_id,
        input.message,
        createDelegationContext(context, parent),
      );
      return toolProcessSuccessResult({ accepted: true, message_id: receipt.messageId });
    },
    listAgents: async (args, context) => {
      const input = systemToolArguments<{ scope?: "children" | "descendants" }>(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      return toolProcessSuccessResult({
        self_id: parent.sessionId,
        parent_id: runtime.delegation.agentParent(parent.sessionId) ?? null,
        agents: runtime.delegation.listAgents(parent.sessionId, input.scope).map(({ run, depth }) => {
          const progress = projectAgentChildRunProgress(run);
          return {
            agent_id: run.childSessionId,
            job_id: run.childRequestId,
            parent_id: run.parentSessionId,
            depth,
            status: run.status,
            task: run.task,
            ...(typeof run.launchContract.label === "string" ? { description: run.launchContract.label } : {}),
            ...(progress ? { progress } : {}),
            result_available: run.finalAnswer !== undefined,
            error_available: run.error !== undefined,
          };
        }),
      });
    },
    interruptAgent: async (args, context) => {
      const input = systemToolArguments<{ agent_id: string }>(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const result = await runtime.delegation.interruptAgent(input.agent_id, parent.sessionId, context.onEvent);
      if (!result) throw new Error("The agent no longer exists.");
      return toolProcessSuccessResult({ agent_id: input.agent_id, status: result.status });
    },
  };
}

function projectAgentJob(run: AgentBackgroundAgentJob) {
  const progress = run.progress;
  return {
    job_id: run.childRequestId,
    kind: "agent",
    agent_id: run.childSessionId,
    state: projectChildRunPublicState(run.status),
    ...(run.description ? { description: run.description } : {}),
    ...(progress ? { progress } : {}),
    ...(run.finalAnswer !== undefined ? { result: run.finalAnswer } : {}),
    ...(run.error !== undefined ? { error: run.error } : {}),
  };
}

function projectJobSummary(job: AgentJobSnapshot) {
  return job.kind === "agent"
    ? {
        job_id: job.childRequestId,
        kind: job.kind,
        agent_id: job.childSessionId,
        state: projectChildRunPublicState(job.status),
        ...(job.description ? { description: job.description } : {}),
      }
    : {
        job_id: job.resourceId,
        kind: job.kind,
        state: job.state,
        command: job.command,
        exit_code: job.exitCode,
        ...(job.interruption ? { interruption: job.interruption } : {}),
      };
}

function projectScheduleInstruction(task: AgentScheduledTaskRecord) {
  return {
    schedule_id: task.id,
    ...(task.name ? { name: task.name } : {}),
    prompt: task.prompt,
    ...(task.type === "once" ? { at: task.schedule } : { recurrence: task.schedule }),
    time_zone: task.timeZone,
    target: task.target ?? "this_session",
    enabled: task.enabled,
    ...(task.nextRunAt ? { next_run_at: task.nextRunAt } : {}),
    admissions: task.runCount,
  };
}

function createDelegationContext(
  context: Parameters<AgentHostToolHandler>[1],
  parent: { readonly sessionId: string; readonly requestId: string },
) {
  const parentToolBatch = projectParentToolBatch(context);
  return {
    parentSessionId: parent.sessionId,
    parentRequestId: parent.requestId,
    ...(context.step !== undefined && context.modelMessageIndex !== undefined
      ? {
          parentInvocation: {
            agentStep: context.step,
            modelMessageIndex: context.modelMessageIndex,
            ...(context.modelContentIndex === undefined ? {} : { modelContentIndex: context.modelContentIndex }),
            ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
          },
        }
      : {}),
    parentModelProviderId: context.modelProviderId,
    parentThinkingLevel: context.thinkingLevel,
    ...(parentToolBatch ? { parentToolBatch } : {}),
    approvalMode: requireApprovalMode(context.approvalMode),
    resourceAccessGrant: context.resourceAccessGrant,
    authorizedToolNames: context.authorizedToolNames ?? [],
    activeSkills: context.activeSkills?.map((skill) => ({ name: skill.name, revision: skill.revision })),
    registry: context.registry,
    onEvent: context.onEvent,
    signal: context.signal,
  };
}

function projectParentToolBatch(
  context: Parameters<AgentHostToolHandler>[1],
): { readonly id: string; readonly spawnCount: number } | undefined {
  const id = context.batchId?.trim();
  const spawnCount =
    context.batchToolNames?.filter((name) => name === AgentOrchestrationToolNames.Subagent).length ?? 0;
  return id && spawnCount > 0 ? { id, spawnCount } : undefined;
}

function requireRunContext(sessionId: string | undefined, requestId: string | undefined) {
  if (!sessionId || !requestId) throw new Error("Orchestration tools require an active session request.");
  return { sessionId, requestId };
}

function requireApprovalMode(mode: AgentExecutionApprovalMode | undefined): AgentExecutionApprovalMode {
  if (!mode) throw new Error("Child-run control requires an active approval mode.");
  return mode;
}
