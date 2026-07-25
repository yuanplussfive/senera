import { z } from "zod";
import { AgentSandboxPreparationStages } from "../AgentSandboxRuntimeTypes.js";
import { readAgentGvisorRuntimePolicyContract } from "./AgentGvisorRuntimeContract.js";

export const AgentGvisorWorkerProtocolVersion = 1;
const RuntimePolicy = readAgentGvisorRuntimePolicyContract();
export const AgentGvisorWorkerMaxFrameBytes = RuntimePolicy.protocol.maxFrameBytes;

const NonEmptyString = z.string().trim().min(1);
const AbsoluteGuestPath = z.string().startsWith("/").min(1);
const InitialMessage = z.object({ protocolVersion: z.literal(AgentGvisorWorkerProtocolVersion) });
const PreparationStage = z.enum(Object.values(AgentSandboxPreparationStages));
const ProgressCount = z.number().int().nonnegative();

export const AgentGvisorExecutionRequestSchema = z
  .object({
    requestId: NonEmptyString,
    image: NonEmptyString,
    command: NonEmptyString,
    arguments: z.array(z.string()).max(RuntimePolicy.protocol.maxArguments),
    cwd: AbsoluteGuestPath,
    environment: z
      .record(z.string().trim().min(1), z.string())
      .refine(
        (value) => Object.keys(value).length <= RuntimePolicy.protocol.maxEnvironmentVariables,
        "Too many environment variables.",
      ),
    stdin: z.string().optional(),
    interactive: z.boolean(),
    workspaceMount: z.enum(["readonly", "writable"]),
    network: z.enum(["disabled", "default"]),
    rootfsCopies: z
      .array(
        z
          .object({
            sourcePath: NonEmptyString,
            guestPath: AbsoluteGuestPath,
          })
          .strict(),
      )
      .max(RuntimePolicy.limits.maxRootfsCopies),
    writableMounts: z
      .array(
        z
          .object({
            sourcePath: NonEmptyString,
            guestPath: AbsoluteGuestPath,
          })
          .strict(),
      )
      .max(RuntimePolicy.limits.maxWritableMounts),
    limits: z
      .object({
        cpus: z.number().positive().max(RuntimePolicy.limits.maxCpuCount),
        memoryMiB: z.number().int().min(64).max(RuntimePolicy.limits.maxMemoryMiB),
        processCount: z.number().int().min(1).max(RuntimePolicy.limits.maxProcessCount),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(RuntimePolicy.limits.maxExecutionSeconds * 1000),
      })
      .strict(),
  })
  .strict();

export type AgentGvisorExecutionRequest = z.infer<typeof AgentGvisorExecutionRequestSchema>;

export const AgentGvisorWorkerClientMessageSchema = z.discriminatedUnion("type", [
  InitialMessage.extend({
    type: z.literal("probe"),
  }).strict(),
  InitialMessage.extend({
    type: z.literal("prepare"),
  }).strict(),
  InitialMessage.extend({
    type: z.literal("start"),
    request: AgentGvisorExecutionRequestSchema,
  }).strict(),
  z
    .object({
      type: z.literal("input"),
      data: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("terminate"),
      signal: z.enum(["interrupt", "terminate", "kill"]),
    })
    .strict(),
  z.object({ type: z.literal("end_input") }).strict(),
]);

export type AgentGvisorWorkerClientMessage = z.infer<typeof AgentGvisorWorkerClientMessageSchema>;

export const AgentGvisorWorkerServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("probe.result"),
      runtimeName: NonEmptyString.optional(),
      contractId: NonEmptyString,
      image: NonEmptyString,
      imageReady: z.boolean(),
      isolation: z.enum(["gvisor", "docker-engine"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("progress"),
      stage: PreparationStage,
      item: z.string().optional(),
      completed: ProgressCount.optional(),
      total: ProgressCount.optional(),
      downloadedBytes: ProgressCount.optional(),
      totalBytes: ProgressCount.optional(),
    })
    .strict(),
  z.object({ type: z.literal("prepared") }).strict(),
  z
    .object({
      type: z.literal("ready"),
      sandboxId: NonEmptyString,
    })
    .strict(),
  z
    .object({
      type: z.literal("output"),
      stream: z.enum(["stdout", "stderr"]),
      data: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("exit"),
      exitCode: z.number().int().nullable(),
      signal: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      code: NonEmptyString,
      message: NonEmptyString,
      details: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
]);

export type AgentGvisorWorkerServerMessage = z.infer<typeof AgentGvisorWorkerServerMessageSchema>;
