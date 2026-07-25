import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { moduleDirPath } from "../../Core/AgentPath.js";
import {
  readAgentSandboxDistributionContract,
  resolveAgentSandboxDistributionTarget,
  type AgentSandboxDistributionTarget,
} from "../AgentSandboxDistributionContract.js";

const ContractIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const DockerApiVersionSchema = z.string().regex(/^\d+\.\d+$/u);
const RuntimeNameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u);
const PosixAbsolutePathSchema = z
  .string()
  .min(1)
  .refine(isNormalizedAbsolutePosixPath, "Path must be a normalized absolute POSIX path.");
const OctalModeSchema = z.string().regex(/^0[0-7]{3,4}$/u);

const AgentDockerEngineTemporaryFilesystemSchema = z
  .object({
    path: PosixAbsolutePathSchema,
    sizeMiB: z.number().int().positive().max(4096),
    mode: OctalModeSchema,
    noSuid: z.boolean(),
    noDevice: z.boolean(),
  })
  .strict();

const AgentDockerEngineCommonPolicySchema = z
  .object({
    formatVersion: z.literal(1),
    id: ContractIdSchema,
    engine: z.object({ minimumApiVersion: DockerApiVersionSchema }).strict(),
    protocol: z
      .object({
        maxFrameBytes: z
          .number()
          .int()
          .min(64 * 1024)
          .max(16 * 1024 * 1024),
        maxArguments: z.number().int().positive().max(4096),
        maxEnvironmentVariables: z.number().int().positive().max(4096),
      })
      .strict(),
    guest: z
      .object({
        workspaceRoot: PosixAbsolutePathSchema,
        user: z.string().trim().min(1),
        shell: z.object({ command: PosixAbsolutePathSchema, arguments: z.array(z.string()).max(16) }).strict(),
        temporaryFilesystems: z.array(AgentDockerEngineTemporaryFilesystemSchema).min(1).max(16),
      })
      .strict(),
    container: z
      .object({
        readOnlyRootFilesystem: z.literal(true),
        init: z.literal(true),
        networkModes: z.object({ disabled: z.literal("none"), default: z.string().trim().min(1) }).strict(),
        securityOptions: z.array(z.string().trim().min(1)).min(1),
        dropCapabilities: z.array(z.string().trim().min(1)).min(1),
        labels: z.record(z.string().trim().min(1), z.string()),
        stopTimeoutSeconds: z.number().int().positive().max(60),
      })
      .strict(),
    defaults: z
      .object({
        cpuCount: z.number().positive(),
        memoryMiB: z.number().int().min(64),
        processCount: z.number().int().positive(),
        network: z.enum(["disabled", "default"]),
      })
      .strict(),
    limits: z
      .object({
        maxCpuCount: z.number().int().positive(),
        maxMemoryMiB: z.number().int().positive(),
        maxProcessCount: z.number().int().positive(),
        maxExecutionSeconds: z.number().int().positive(),
        maxConcurrentExecutions: z.number().int().positive().max(1024),
        maxRootfsCopies: z.number().int().nonnegative(),
        maxWritableMounts: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((contract, context) => {
    const paths = [contract.guest.workspaceRoot, ...contract.guest.temporaryFilesystems.map((entry) => entry.path)];
    if (new Set(paths).size !== paths.length) {
      context.addIssue({ code: "custom", path: ["guest"], message: "Guest paths must be unique." });
    }
    if (
      contract.defaults.cpuCount > contract.limits.maxCpuCount ||
      contract.defaults.memoryMiB > contract.limits.maxMemoryMiB ||
      contract.defaults.processCount > contract.limits.maxProcessCount
    ) {
      context.addIssue({ code: "custom", path: ["defaults"], message: "Defaults must fit declared limits." });
    }
  });

const AgentDockerEngineProviderOverlaySchema = z
  .object({
    formatVersion: z.literal(1),
    id: ContractIdSchema,
    provider: z.enum(["gvisor", "docker-engine"]),
    runtime: z.discriminatedUnion("strategy", [
      z.object({ strategy: z.literal("registered"), name: RuntimeNameSchema, platform: z.literal("linux") }).strict(),
      z.object({ strategy: z.literal("daemon-default"), platform: z.literal("linux") }).strict(),
    ]),
    container: z.object({ labels: z.record(z.string().trim().min(1), z.string()) }).strict(),
  })
  .strict();

export const AgentGvisorRuntimeContractSchema = AgentDockerEngineCommonPolicySchema.extend({
  provider: z.literal("gvisor"),
  runtime: z
    .object({ strategy: z.literal("registered"), name: RuntimeNameSchema, platform: z.literal("linux") })
    .strict(),
});

export const AgentDockerEngineRuntimeContractSchema = AgentDockerEngineCommonPolicySchema.extend({
  provider: z.enum(["gvisor", "docker-engine"]),
  runtime: z.discriminatedUnion("strategy", [
    z.object({ strategy: z.literal("registered"), name: RuntimeNameSchema, platform: z.literal("linux") }).strict(),
    z.object({ strategy: z.literal("daemon-default"), platform: z.literal("linux") }).strict(),
  ]),
});

export type AgentDockerEngineSandboxProvider = "gvisor" | "docker-engine";
export type AgentGvisorRuntimeContract = z.infer<typeof AgentGvisorRuntimeContractSchema>;
export type AgentDockerEngineRuntimeContract = z.infer<typeof AgentDockerEngineRuntimeContractSchema>;

export interface ResolvedAgentDockerEngineRuntimeContract {
  contract: AgentDockerEngineRuntimeContract;
  distribution: {
    id: string;
    version: string;
    target: string;
  };
  image: AgentSandboxDistributionTarget;
}

export type ResolvedAgentGvisorRuntimeContract = ResolvedAgentDockerEngineRuntimeContract & {
  contract: AgentGvisorRuntimeContract;
};

export function readAgentDockerEngineRuntimeContract(
  provider: AgentDockerEngineSandboxProvider,
  architecture: string = process.arch,
): ResolvedAgentDockerEngineRuntimeContract {
  const contract = readAgentDockerEngineRuntimePolicyContract(provider);
  const distribution = readAgentSandboxDistributionContract();
  return {
    contract,
    distribution: {
      id: distribution.id,
      version: distribution.archiveVersion,
      target: architecture,
    },
    image: resolveAgentSandboxDistributionTarget(distribution, architecture),
  };
}

export function readAgentGvisorRuntimeContract(
  architecture: string = process.arch,
): ResolvedAgentGvisorRuntimeContract {
  return readAgentDockerEngineRuntimeContract("gvisor", architecture) as ResolvedAgentGvisorRuntimeContract;
}

export function readAgentDockerEngineRuntimePolicyContract(
  provider: AgentDockerEngineSandboxProvider,
): AgentDockerEngineRuntimeContract {
  const common = AgentDockerEngineCommonPolicySchema.parse(readJson("../DockerEngine/contract.json"));
  const overlay = AgentDockerEngineProviderOverlaySchema.parse(
    readJson(provider === "gvisor" ? "contract.json" : "../DockerEngine/Default/contract.json"),
  );
  if (overlay.provider !== provider) {
    throw new Error(
      `Docker Engine sandbox overlay provider mismatch: expected ${provider}, received ${overlay.provider}.`,
    );
  }
  return AgentDockerEngineRuntimeContractSchema.parse({
    ...common,
    id: overlay.id,
    provider: overlay.provider,
    runtime: overlay.runtime,
    container: {
      ...common.container,
      labels: { ...common.container.labels, ...overlay.container.labels },
    },
  });
}

export function readAgentGvisorRuntimePolicyContract(): AgentGvisorRuntimeContract {
  return readAgentDockerEngineRuntimePolicyContract("gvisor") as AgentGvisorRuntimeContract;
}

function readJson(relativePath: string): unknown {
  const contractPath = path.resolve(moduleDirPath(import.meta.url), relativePath);
  return JSON.parse(fs.readFileSync(contractPath, "utf8"));
}

function isNormalizedAbsolutePosixPath(value: string): boolean {
  return value.startsWith("/") && value !== "/" && path.posix.normalize(value) === value;
}
