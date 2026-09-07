import { z } from "zod";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import {
  AgentDelegationExecutionModes,
  type AgentDelegationService,
  type AgentSupervisorContactRequest,
} from "./AgentDelegationService.js";
import {
  AgentChildRunMessageDirections,
  AgentChildRunMessageKinds,
  AgentChildRunProgressPhases,
  AgentChildRunStatuses,
  type AgentChildRunRecord,
  type AgentChildRunProgressProjection,
} from "./AgentChildRunTypes.js";
import type { AgentScheduleRuntime } from "./AgentScheduleRuntime.js";

const NonEmptyString = z.string().trim().min(1);
const RunIdSchema = NonEmptyString.describe("Child-run ID returned by AgentSpawn.");
const ToolNamesSchema = z.array(NonEmptyString).min(1);
export const AgentOrchestrationToolNames = Object.freeze({
  Spawn: "AgentSpawn",
  Wait: "AgentWait",
  List: "AgentList",
  Input: "AgentInput",
  Stop: "AgentStop",
  Resume: "AgentResume",
  ContactSupervisor: "AgentContactSupervisor",
  ScheduleManage: "AgentScheduleManage",
});
const ScheduleExpressionSchema = NonEmptyString.describe(
  'Schedule syntax by type. once: prefer a relative delay such as "+30m", "+2h", or "+1d"; use an ISO 8601 timestamp with an explicit offset only for a fixed calendar time. interval: "30s", "5m", or "1h". cron: a 5/6-field cron expression. Do not use natural-language dates.',
);

export const AgentSpawnArgumentsSchema = z
  .object({
    task: NonEmptyString.describe("Self-contained task assigned to the child agent."),
    agent: NonEmptyString.optional().describe(
      "Optional role from the host role catalog. Omit it to use the catalog-declared default role.",
    ),
    forkContext: z
      .boolean()
      .optional()
      .describe("True forks parent conversation context; false starts fresh; omission follows the role contract."),
  })
  .strict();

export const AgentWaitArgumentsSchema = z
  .object({
    targets: z.array(RunIdSchema).min(1).describe("Child runs to observe."),
    mode: z
      .enum(["any", "all"])
      .default("any")
      .describe("Resolve when any target settles, or only after all targets settle."),
    timeoutMs: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional()
      .describe("Optional wait timeout. Timing out never stops a child run."),
  })
  .strict();

export const AgentListArgumentsSchema = z
  .object({
    includeCompleted: z
      .boolean()
      .default(true)
      .describe("Include terminal runs so a follow-up can report the final result after a restart."),
  })
  .strict();

export const AgentInputArgumentsSchema = z
  .object({
    target: RunIdSchema,
    message: NonEmptyString,
    interrupt: z
      .boolean()
      .default(false)
      .describe("True redirects active work; false queues a follow-up after the current assignment."),
  })
  .strict();

export const AgentStopArgumentsSchema = z.object({ target: RunIdSchema }).strict();

export const AgentResumeArgumentsSchema = z
  .object({
    target: RunIdSchema,
    task: NonEmptyString.describe("New instruction executed in the persisted child session context."),
  })
  .strict();

export const AgentContactSupervisorArgumentsSchema = z
  .object({
    reason: z.enum(["need_decision", "progress_update"]),
    message: NonEmptyString,
  })
  .strict();

const ScheduleCreateSchema = z
  .object({
    action: z.literal("create"),
    name: NonEmptyString.optional(),
    description: NonEmptyString.optional(),
    prompt: NonEmptyString,
    type: z.enum(["cron", "once", "interval"]),
    schedule: ScheduleExpressionSchema,
    executionMode: z
      .enum(["at_due_time", "execute_now_deliver_at"])
      .optional()
      .describe(
        "Run at the scheduled time, or execute a one-time task now and deliver its result at the scheduled time.",
      ),
    enabled: z.boolean().default(true),
    modelProviderId: NonEmptyString.optional(),
    allowedToolNames: ToolNamesSchema.optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

const ScheduleUpdateSchema = z
  .object({
    action: z.literal("update"),
    taskId: NonEmptyString,
    name: NonEmptyString.optional(),
    description: NonEmptyString.optional(),
    prompt: NonEmptyString.optional(),
    type: z.enum(["cron", "once", "interval"]).optional(),
    schedule: ScheduleExpressionSchema.optional(),
    enabled: z.boolean().optional(),
    modelProviderId: NonEmptyString.optional(),
    allowedToolNames: ToolNamesSchema.optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

const ScheduleTaskActionSchema = z
  .object({
    action: z.enum(["get", "delete", "run_now"]),
    taskId: NonEmptyString,
  })
  .strict();

const ScheduleListActionSchema = z.object({ action: z.enum(["list", "status"]) }).strict();

export const AgentScheduleManageArgumentsSchema = z.discriminatedUnion("action", [
  ScheduleCreateSchema,
  ScheduleUpdateSchema,
  ScheduleTaskActionSchema,
  ScheduleListActionSchema,
]);

export interface AgentOrchestrationHostRuntime {
  readonly delegation: AgentDelegationService;
  readonly schedules: AgentScheduleRuntime;
}

export function createAgentOrchestrationHostHandlers(runtime: AgentOrchestrationHostRuntime): {
  readonly spawn: AgentHostToolHandler;
  readonly list: AgentHostToolHandler;
  readonly wait: AgentHostToolHandler;
  readonly input: AgentHostToolHandler;
  readonly stop: AgentHostToolHandler;
  readonly resume: AgentHostToolHandler;
  readonly contactSupervisor: AgentHostToolHandler;
  readonly scheduleManage: AgentHostToolHandler;
} {
  return {
    spawn: async (args, context) => {
      throwIfAborted(context.signal);
      const input = AgentSpawnArgumentsSchema.parse(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const record = await runtime.delegation.spawn(input, createDelegationContext(context, parent));
      return toolProcessSuccessResult({ run: projectAgentChildRunView(record, record.id) });
    },
    list: async (args, context) => {
      throwIfAborted(context.signal);
      const input = AgentListArgumentsSchema.parse(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const runs = runtime.delegation
        .list(parent.sessionId)
        .filter((run) => input.includeCompleted || !isTerminalChildRunStatus(run.status));
      return toolProcessSuccessResult({
        runs: runs.map((run) => projectAgentChildRunView(run, run.id)),
      });
    },
    wait: async (args, context) => {
      throwIfAborted(context.signal);
      const input = AgentWaitArgumentsSchema.parse(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const result =
        input.mode === "all"
          ? await runtime.delegation.waitAll(input.targets, parent.sessionId, input.timeoutMs, context.signal)
          : await runtime.delegation.waitAny(input.targets, parent.sessionId, input.timeoutMs, context.signal);
      return toolProcessSuccessResult({
        runs: input.targets.map((target, index) => projectAgentChildRunView(result.runs[index], target)),
        waitTimedOut: result.timedOut,
      });
    },
    input: async (args, context) => {
      throwIfAborted(context.signal);
      const input = AgentInputArgumentsSchema.parse(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const submission = await runtime.delegation.sendInput(
        input.target,
        parent.sessionId,
        input.message,
        input.interrupt,
        createDelegationContext(context, parent),
      );
      const current = submission?.run ?? runtime.delegation.get(input.target, parent.sessionId);
      return toolProcessSuccessResult({
        accepted: submission !== undefined,
        run: projectAgentChildRunView(current, input.target),
      });
    },
    stop: async (args, context) => {
      throwIfAborted(context.signal);
      const input = AgentStopArgumentsSchema.parse(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const previous = runtime.delegation.get(input.target, parent.sessionId);
      const current = await runtime.delegation.stop(input.target, parent.sessionId, context.onEvent);
      return toolProcessSuccessResult({
        accepted: previous !== undefined && isStoppableChildRun(previous.status),
        run: projectAgentChildRunView(current, input.target),
      });
    },
    resume: async (args, context) => {
      throwIfAborted(context.signal);
      const input = AgentResumeArgumentsSchema.parse(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const record = await runtime.delegation.resume(
        input.target,
        parent.sessionId,
        input.task,
        createDelegationContext(context, parent),
        AgentDelegationExecutionModes.Detach,
      );
      return toolProcessSuccessResult({
        accepted: record !== undefined,
        run: projectAgentChildRunView(record, input.target),
      });
    },
    contactSupervisor: async (args, context) => {
      throwIfAborted(context.signal);
      const input = AgentContactSupervisorArgumentsSchema.parse(args) as AgentSupervisorContactRequest;
      if (!context.sessionId || !context.requestId) throw new Error("Supervisor contact requires an active child run.");
      const result = await runtime.delegation.contactSupervisor(
        context.sessionId,
        context.requestId,
        input,
        context.onEvent,
      );
      const control =
        result.run.status === AgentChildRunStatuses.AwaitingSupervisor
          ? {
              kind: "SuspendChildRun" as const,
              childRunId: result.run.id,
              messageId: result.message.id,
              message: result.message.content,
            }
          : undefined;
      return toolProcessSuccessResult({
        run: projectAgentChildRunView(result.run, result.run.id),
        ...(control ? { control } : {}),
      });
    },
    scheduleManage: async (args, context) => {
      throwIfAborted(context.signal);
      const input = AgentScheduleManageArgumentsSchema.parse(args);
      const parent = requireRunContext(context.sessionId, context.requestId);
      const scheduleContext = {
        sessionId: parent.sessionId,
        requestId: parent.requestId,
        modelProviderId: context.modelProviderId,
        authorizedToolNames: context.authorizedToolNames ?? [],
        registry: context.registry,
      };
      switch (input.action) {
        case "create":
          return toolProcessSuccessResult({ task: await runtime.schedules.create(input, scheduleContext) });
        case "update": {
          const { action: _action, taskId, ...patch } = input;
          return toolProcessSuccessResult({
            task: (await runtime.schedules.update(taskId, patch, scheduleContext)) ?? null,
          });
        }
        case "get":
          return toolProcessSuccessResult({
            task: (await runtime.schedules.get(input.taskId, parent.sessionId)) ?? null,
          });
        case "delete":
          return toolProcessSuccessResult({
            taskId: input.taskId,
            deleted: await runtime.schedules.delete(input.taskId, parent.sessionId),
          });
        case "run_now":
          return toolProcessSuccessResult({
            task: (await runtime.schedules.runNow(input.taskId, parent.sessionId)) ?? null,
          });
        case "list":
          return toolProcessSuccessResult({ tasks: await runtime.schedules.list(parent.sessionId) });
        case "status":
          return toolProcessSuccessResult({ status: await runtime.schedules.status() });
      }
    },
  };
}

export type AgentChildRunPublicState =
  "not_found" | "queued" | "running" | "needs_input" | "stopping" | "completed" | "failed" | "cancelled";

export interface AgentChildRunPublicView {
  readonly runId: string;
  readonly state: AgentChildRunPublicState;
  readonly agent?: string;
  readonly joinGroup?: { readonly id: string; readonly mode: "any" | "all"; readonly expectedCount: number };
  readonly result?: { readonly content: string };
  readonly error?: string;
  readonly request?: { readonly id: string; readonly message: string };
  readonly progress?: AgentChildRunProgressProjection;
}

export function projectAgentChildRunView(run: AgentChildRunRecord | undefined, runId: string): AgentChildRunPublicView {
  if (!run) return { runId, state: "not_found" };
  const supervisorRequest =
    run.status === AgentChildRunStatuses.AwaitingSupervisor
      ? [...run.messages]
          .reverse()
          .find(
            (message) =>
              message.direction === AgentChildRunMessageDirections.ChildToParent &&
              message.kind === AgentChildRunMessageKinds.Decision,
          )
      : undefined;
  const progress = projectAgentChildRunProgress(run);
  return {
    runId: run.id,
    state: projectChildRunPublicState(run.status),
    agent: run.agentName,
    ...(run.joinGroup ? { joinGroup: run.joinGroup } : {}),
    ...(run.finalAnswer !== undefined ? { result: { content: run.finalAnswer } } : {}),
    ...(run.error !== undefined ? { error: run.error } : {}),
    ...(supervisorRequest ? { request: { id: supervisorRequest.id, message: supervisorRequest.content } } : {}),
    ...(progress ? { progress } : {}),
  };
}

function projectAgentChildRunProgress(run: AgentChildRunRecord): AgentChildRunProgressProjection | undefined {
  if (isTerminalChildRunStatus(run.status)) return undefined;
  if (!run.snapshot && !run.checkpoint) return undefined;

  const snapshot = run.snapshot;
  const activeTools = snapshot?.activeTools ?? [];
  const phase = readAgentChildRunProgressPhase(run, activeTools);
  return {
    phase,
    ...(snapshot?.lastActivityAt ? { lastActivityAt: snapshot.lastActivityAt } : {}),
    activeTools,
    toolCalls: snapshot?.toolCalls ?? { planned: 0, started: 0, completed: 0, failed: 0 },
    checkpointAvailable: run.checkpoint !== undefined,
    artifactCount: snapshot?.artifactUris.length ?? 0,
  };
}

function isTerminalChildRunStatus(status: AgentChildRunRecord["status"]): boolean {
  switch (status) {
    case AgentChildRunStatuses.Completed:
    case AgentChildRunStatuses.PartialCompleted:
    case AgentChildRunStatuses.Interrupted:
    case AgentChildRunStatuses.TimedOut:
    case AgentChildRunStatuses.Failed:
    case AgentChildRunStatuses.Cancelled:
      return true;
    case AgentChildRunStatuses.Queued:
    case AgentChildRunStatuses.Running:
    case AgentChildRunStatuses.WrappingUp:
    case AgentChildRunStatuses.Cancelling:
    case AgentChildRunStatuses.AwaitingSupervisor:
      return false;
  }
}

function readAgentChildRunProgressPhase(
  run: AgentChildRunRecord,
  activeTools: readonly string[],
): AgentChildRunProgressProjection["phase"] {
  switch (run.status) {
    case AgentChildRunStatuses.Queued:
      return AgentChildRunProgressPhases.Queued;
    case AgentChildRunStatuses.AwaitingSupervisor:
      return AgentChildRunProgressPhases.AwaitingSupervisor;
    case AgentChildRunStatuses.WrappingUp:
      return AgentChildRunProgressPhases.WrappingUp;
    case AgentChildRunStatuses.Cancelling:
      return AgentChildRunProgressPhases.Cancelling;
    case AgentChildRunStatuses.Completed:
    case AgentChildRunStatuses.PartialCompleted:
      return AgentChildRunProgressPhases.Completed;
    case AgentChildRunStatuses.Failed:
    case AgentChildRunStatuses.Interrupted:
    case AgentChildRunStatuses.TimedOut:
      return AgentChildRunProgressPhases.Failed;
    case AgentChildRunStatuses.Cancelled:
      return AgentChildRunProgressPhases.Cancelled;
    case AgentChildRunStatuses.Running:
      if (activeTools.length > 0) return AgentChildRunProgressPhases.ToolExecution;
      if (run.snapshot && run.snapshot.lastModelOutputAt === run.snapshot.lastActivityAt) {
        return AgentChildRunProgressPhases.ModelOutput;
      }
      return AgentChildRunProgressPhases.Starting;
  }
}

function projectChildRunPublicState(status: AgentChildRunRecord["status"]): AgentChildRunPublicState {
  switch (status) {
    case AgentChildRunStatuses.Queued:
      return "queued";
    case AgentChildRunStatuses.Running:
    case AgentChildRunStatuses.WrappingUp:
      return "running";
    case AgentChildRunStatuses.AwaitingSupervisor:
      return "needs_input";
    case AgentChildRunStatuses.Cancelling:
      return "stopping";
    case AgentChildRunStatuses.Completed:
    case AgentChildRunStatuses.PartialCompleted:
      return "completed";
    case AgentChildRunStatuses.Interrupted:
    case AgentChildRunStatuses.TimedOut:
    case AgentChildRunStatuses.Failed:
      return "failed";
    case AgentChildRunStatuses.Cancelled:
      return "cancelled";
  }
}

function isStoppableChildRun(status: AgentChildRunRecord["status"]): boolean {
  const stoppableStatuses: readonly AgentChildRunRecord["status"][] = [
    AgentChildRunStatuses.Queued,
    AgentChildRunStatuses.Running,
    AgentChildRunStatuses.WrappingUp,
    AgentChildRunStatuses.Cancelling,
    AgentChildRunStatuses.AwaitingSupervisor,
  ];
  return stoppableStatuses.includes(status);
}

function createDelegationContext(
  context: Parameters<AgentHostToolHandler>[1],
  parent: { readonly sessionId: string; readonly requestId: string },
) {
  const parentToolBatch = projectParentToolBatch(context);
  return {
    parentSessionId: parent.sessionId,
    parentRequestId: parent.requestId,
    parentModelProviderId: context.modelProviderId,
    parentThinkingLevel: context.thinkingLevel,
    ...(parentToolBatch ? { parentToolBatch } : {}),
    approvalMode: requireApprovalMode(context.approvalMode),
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
  const spawnCount = context.batchToolNames?.filter((name) => name === AgentOrchestrationToolNames.Spawn).length ?? 0;
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
