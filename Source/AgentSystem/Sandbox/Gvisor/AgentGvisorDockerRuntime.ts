import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAgentUnknownRecord as isRecord } from "../../Core/AgentUnknownValue.js";
import { PassThrough, type Duplex, type Readable } from "node:stream";
import { finished } from "node:stream/promises";
import Docker from "dockerode";
import tar from "tar-fs";
import type { AgentGvisorExecutionRequest } from "./AgentGvisorWorkerProtocol.js";
import {
  readAgentDockerEngineRuntimeContract,
  type AgentDockerEngineSandboxProvider,
  type ResolvedAgentDockerEngineRuntimeContract,
} from "./AgentGvisorRuntimeContract.js";
import type { SeneraTerminalSignal } from "../../Execution/SeneraTerminalTypes.js";
import { AgentSandboxPreparationStages, type AgentSandboxPreparationProgress } from "../AgentSandboxRuntimeTypes.js";
import { isPathWithin } from "../../Core/AgentPath.js";
import { selectAgentSandboxProvider } from "../AgentSandboxProviderSelection.js";
import { AgentSandboxRuntimeProviders } from "../AgentSandboxRuntimeTypes.js";
import type { AgentSandboxProviderPreference } from "../../Types/AgentRuntimeConfigTypes.js";
import { AgentSandboxRuntimeImageLabels } from "../AgentSandboxDistributionContract.js";

export type AgentGvisorWorkspaceSource = { kind: "bind"; sourcePath: string } | { kind: "volume"; volumeName: string };

export interface AgentGvisorDockerRuntimeOptions {
  docker: Docker;
  workspace: AgentGvisorWorkspaceSource;
  copySourceRoots: readonly string[];
  provider?: AgentDockerEngineSandboxProvider;
  runtimeName?: string;
  runtimeContract?: ResolvedAgentDockerEngineRuntimeContract;
  imageReference: string;
  containerNameFactory?: () => string;
}

export interface AgentGvisorDockerProcessExit {
  exitCode: number | null;
  signal: string | null;
}

export interface AgentGvisorDockerProcess {
  readonly id: string;
  readonly stdin: Duplex;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly completion: Promise<AgentGvisorDockerProcessExit>;
  terminate(signal: SeneraTerminalSignal): Promise<void>;
  cleanup(): Promise<void>;
}

export interface AgentGvisorDockerRuntime {
  provider(): AgentDockerEngineSandboxProvider;
  probe(): Promise<{
    provider: AgentDockerEngineSandboxProvider;
    runtimeName?: string;
    contractId: string;
    image: string;
    imageReady: boolean;
  }>;
  prepare(input?: { onProgress?: (progress: AgentSandboxPreparationProgress) => void }): Promise<void>;
  start(request: AgentGvisorExecutionRequest): Promise<AgentGvisorDockerProcess>;
}

export interface AgentDockerEngineSandboxProviderResolution {
  provider: AgentDockerEngineSandboxProvider;
  registeredRuntimes: readonly string[];
}

/** Resolves the engine-backed provider once, before any sandbox container is created. */
export async function resolveAgentDockerEngineSandboxProvider(input: {
  docker: Docker;
  preference: Exclude<AgentSandboxProviderPreference, "microsandbox">;
}): Promise<AgentDockerEngineSandboxProviderResolution> {
  const info = (await input.docker.info()) as DockerEngineInfo;
  const registeredRuntimes = Object.keys(info.Runtimes ?? {}).sort();
  const selected = selectAgentSandboxProvider({
    preference: input.preference,
    platform: "linux",
    capabilities: {
      microsandboxHost: false,
      dockerEngine: true,
      registeredDockerRuntimes: registeredRuntimes,
    },
  });
  if (selected === AgentSandboxRuntimeProviders.Microsandbox) {
    throw new Error("The Docker Engine worker cannot select the microsandbox provider.");
  }
  return { provider: selected, registeredRuntimes };
}

export class AgentGvisorDockerEngineRuntime implements AgentGvisorDockerRuntime {
  private readonly resolvedContract: ResolvedAgentDockerEngineRuntimeContract;
  private readonly runtimeName: string | undefined;
  private readonly copySourceRoots: readonly string[];
  private readonly containerNameFactory: () => string;
  private readonly imageReference: string;
  private prepared = false;

  constructor(private readonly options: AgentGvisorDockerRuntimeOptions) {
    this.resolvedContract =
      options.runtimeContract ?? readAgentDockerEngineRuntimeContract(options.provider ?? "gvisor");
    this.runtimeName = resolveRuntimeName(this.resolvedContract, options.runtimeName);
    this.copySourceRoots = options.copySourceRoots.map((root) => path.resolve(root));
    this.imageReference = requireImageReference(options.imageReference);
    this.containerNameFactory =
      options.containerNameFactory ?? (() => `${this.resolvedContract.contract.id}-${randomUUID()}`);
  }

  provider(): AgentDockerEngineSandboxProvider {
    return this.resolvedContract.contract.provider;
  }

  async probe(): Promise<{
    provider: AgentDockerEngineSandboxProvider;
    runtimeName?: string;
    contractId: string;
    image: string;
    imageReady: boolean;
  }> {
    await this.assertEngineCompatible();
    await this.assertRuntimeStrategyAvailable();
    const imageReady = await this.validateImageIfPresent(this.imageReference);
    return {
      provider: this.provider(),
      ...(this.runtimeName ? { runtimeName: this.runtimeName } : {}),
      contractId: this.resolvedContract.contract.id,
      image: this.imageReference,
      imageReady,
    };
  }

  async prepare(
    input: {
      onProgress?: (progress: AgentSandboxPreparationProgress) => void;
    } = {},
  ): Promise<void> {
    this.prepared = false;
    input.onProgress?.({
      stage: AgentSandboxPreparationStages.LoadingRuntime,
      item: this.runtimeName ?? "Docker Engine default runtime",
    });
    await this.assertEngineCompatible();
    await this.assertRuntimeStrategyAvailable();
    const image = this.imageReference;
    if (!(await this.validateImageIfPresent(image))) {
      throw new Error(
        `Docker sandbox runtime image is unavailable: ${image}. The deployment must pull the declared image before starting the Worker.`,
      );
    }
    input.onProgress?.({ stage: AgentSandboxPreparationStages.ProbingSandbox, item: image });
    await this.runProbeContainer();
    this.prepared = true;
  }

  async start(request: AgentGvisorExecutionRequest): Promise<AgentGvisorDockerProcess> {
    if (!this.prepared) {
      throw new Error("Docker sandbox runtime must be prepared before starting an execution.");
    }
    this.assertRequestPolicy(request);
    const container = await this.options.docker.createContainer(this.createContainerOptions(request));
    let stagingRoot: string | undefined;
    try {
      if (request.rootfsCopies.length > 0) {
        stagingRoot = await this.stageRootfsCopies(request.rootfsCopies);
        await container.putArchive(tar.pack(stagingRoot), { path: "/" });
      }
      const attached = (await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        hijack: true,
      })) as Duplex;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      dockerModem(this.options.docker).demuxStream(attached, stdout, stderr);
      await container.start();

      const cleanup = onceAsync(async () => {
        attached.destroy();
        await container.remove({ force: true }).catch(ignoreMissingDockerResource);
        if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true });
      });
      const completion = (async (): Promise<AgentGvisorDockerProcessExit> => {
        const result = (await container.wait({ condition: "not-running" })) as DockerContainerWaitResult;
        await finished(attached, { cleanup: true }).catch(() => undefined);
        stdout.end();
        stderr.end();
        return {
          exitCode:
            typeof result.StatusCode === "number" && Number.isInteger(result.StatusCode) ? result.StatusCode : null,
          signal: null,
        };
      })();

      return {
        id: container.id,
        stdin: attached,
        stdout,
        stderr,
        completion,
        terminate: async (signal) => {
          await container.kill({ signal: dockerSignal(signal) }).catch(ignoreStoppedDockerContainer);
        },
        cleanup,
      };
    } catch (error) {
      await container.remove({ force: true }).catch(ignoreMissingDockerResource);
      if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true });
      throw dockerOperationError("start", error);
    }
  }

  private createContainerOptions(request: AgentGvisorExecutionRequest): Docker.ContainerCreateOptions {
    const contract = this.resolvedContract.contract;
    const mounts: Docker.MountSettings[] = [
      {
        Type: this.options.workspace.kind,
        Source:
          this.options.workspace.kind === "bind"
            ? path.resolve(this.options.workspace.sourcePath)
            : this.options.workspace.volumeName,
        Target: contract.guest.workspaceRoot,
        ReadOnly: request.workspaceMount === "readonly",
      },
      ...request.writableMounts.map((mount): Docker.MountSettings => {
        this.assertCopySource(mount.sourcePath);
        return {
          Type: "bind",
          Source: path.resolve(mount.sourcePath),
          Target: normalizeGuestPath(mount.guestPath),
          ReadOnly: false,
        };
      }),
    ];
    const tmpfs = Object.fromEntries(
      contract.guest.temporaryFilesystems.map((entry) => [entry.path, serializeTmpfsOptions(entry)]),
    );
    return {
      name: this.containerNameFactory(),
      platform: contract.runtime.platform,
      Image: this.imageReference,
      Entrypoint: [request.command],
      Cmd: [...request.arguments],
      WorkingDir: normalizeGuestPath(request.cwd),
      User: contract.guest.user,
      Env: Object.entries(request.environment).map(([name, value]) => `${name}=${value}`),
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,
      StdinOnce: false,
      Tty: false,
      Labels: {
        ...contract.container.labels,
        "ai.senera.request-id": request.requestId,
      },
      StopTimeout: contract.container.stopTimeoutSeconds,
      HostConfig: {
        ...(this.runtimeName ? { Runtime: this.runtimeName } : {}),
        NetworkMode: contract.container.networkModes[request.network],
        ReadonlyRootfs: contract.container.readOnlyRootFilesystem,
        Init: contract.container.init,
        SecurityOpt: [...contract.container.securityOptions],
        CapDrop: [...contract.container.dropCapabilities],
        NanoCpus: Math.round(request.limits.cpus * 1_000_000_000),
        Memory: request.limits.memoryMiB * 1024 * 1024,
        PidsLimit: request.limits.processCount,
        Tmpfs: tmpfs,
        Mounts: mounts,
      },
    };
  }

  private async runProbeContainer(): Promise<void> {
    const probe = this.resolvedContract.image.probe;
    const contract = this.resolvedContract.contract;
    const container = await this.options.docker.createContainer({
      name: this.containerNameFactory(),
      platform: contract.runtime.platform,
      Image: this.imageReference,
      Entrypoint: [probe.command],
      Cmd: [...probe.arguments],
      AttachStdout: false,
      AttachStderr: false,
      NetworkDisabled: true,
      User: contract.guest.user,
      Labels: contract.container.labels,
      HostConfig: {
        ...(this.runtimeName ? { Runtime: this.runtimeName } : {}),
        NetworkMode: contract.container.networkModes.disabled,
        ReadonlyRootfs: contract.container.readOnlyRootFilesystem,
        Init: contract.container.init,
        SecurityOpt: [...contract.container.securityOptions],
        CapDrop: [...contract.container.dropCapabilities],
        Tmpfs: Object.fromEntries(
          contract.guest.temporaryFilesystems.map((entry) => [entry.path, serializeTmpfsOptions(entry)]),
        ),
      },
    });
    try {
      await container.start();
      const result = (await container.wait({ condition: "not-running" })) as DockerContainerWaitResult;
      if (result.StatusCode !== 0) {
        throw new Error(`${this.provider()} sandbox probe exited with status ${String(result.StatusCode)}.`);
      }
    } finally {
      await container.remove({ force: true }).catch(ignoreMissingDockerResource);
    }
  }

  private assertRequestPolicy(request: AgentGvisorExecutionRequest): void {
    const limits = this.resolvedContract.contract.limits;
    const violations = [
      request.limits.cpus <= limits.maxCpuCount ? undefined : "cpu",
      request.limits.memoryMiB <= limits.maxMemoryMiB ? undefined : "memory",
      request.limits.processCount <= limits.maxProcessCount ? undefined : "process_count",
      request.limits.timeoutMs <= limits.maxExecutionSeconds * 1000 ? undefined : "execution_time",
      request.rootfsCopies.length <= limits.maxRootfsCopies ? undefined : "rootfs_copies",
      request.writableMounts.length <= limits.maxWritableMounts ? undefined : "writable_mounts",
    ].filter((value): value is string => Boolean(value));
    if (violations.length > 0) {
      throw new Error(`${this.provider()} execution request violates the runtime contract: ${violations.join(", ")}.`);
    }
    normalizeGuestPath(request.cwd);
    for (const copy of request.rootfsCopies) {
      this.assertCopySource(copy.sourcePath);
      normalizeGuestPath(copy.guestPath);
    }
  }

  private async assertEngineCompatible(): Promise<void> {
    const version = await this.options.docker.version();
    const actual = typeof version.ApiVersion === "string" ? version.ApiVersion : "0.0";
    const minimum = this.resolvedContract.contract.engine.minimumApiVersion;
    if (compareDockerApiVersions(actual, minimum) < 0) {
      throw new Error(`Docker Engine API ${minimum} or newer is required; connected daemon reports ${actual}.`);
    }
  }

  private async assertRuntimeStrategyAvailable(): Promise<void> {
    if (!this.runtimeName) return;
    const info = (await this.options.docker.info()) as DockerEngineInfo;
    if (!info.Runtimes || !Object.hasOwn(info.Runtimes, this.runtimeName)) {
      throw new Error(`Docker runtime ${this.runtimeName} is not registered on the connected daemon.`);
    }
  }

  private async validateImageIfPresent(image: string): Promise<boolean> {
    try {
      const inspection = await this.options.docker.getImage(image).inspect();
      this.assertImageIdentity(inspection.Config?.Labels ?? {});
      return true;
    } catch (error) {
      if (dockerStatusCode(error) === 404) return false;
      throw dockerOperationError("inspect image", error);
    }
  }

  private assertImageIdentity(labels: Record<string, string>): void {
    const distribution = this.resolvedContract.distribution;
    const expected = {
      [AgentSandboxRuntimeImageLabels.distributionId]: distribution.id,
      [AgentSandboxRuntimeImageLabels.distributionVersion]: distribution.version,
      [AgentSandboxRuntimeImageLabels.target]: distribution.target,
      [AgentSandboxRuntimeImageLabels.sourceImage]: this.resolvedContract.image.sourceImage,
    };
    const mismatches = Object.entries(expected).flatMap(([name, value]) =>
      labels[name] === value
        ? []
        : [`${name}=${JSON.stringify(labels[name] ?? null)} (expected ${JSON.stringify(value)})`],
    );
    if (mismatches.length > 0) {
      throw new Error(`Docker sandbox runtime image identity is invalid: ${mismatches.join(", ")}.`);
    }
  }

  private async stageRootfsCopies(copies: AgentGvisorExecutionRequest["rootfsCopies"]): Promise<string> {
    const stagingRoot = await mkdtemp(path.join(os.tmpdir(), `${this.resolvedContract.contract.id}-`));
    try {
      for (const copy of copies) {
        this.assertCopySource(copy.sourcePath);
        const guestPath = normalizeGuestPath(copy.guestPath);
        const destination = path.join(stagingRoot, ...guestPath.slice(1).split("/"));
        await cp(copy.sourcePath, destination, { recursive: true, force: true });
      }
      return stagingRoot;
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private assertCopySource(sourcePath: string): void {
    const resolved = path.resolve(sourcePath);
    if (this.copySourceRoots.some((root) => isPathWithin(root, resolved))) return;
    throw new Error(`${this.provider()} file source is outside the worker allowlist: ${sourcePath}`);
  }
}

interface DockerEngineInfo {
  Runtimes?: Record<string, unknown>;
}

interface DockerContainerWaitResult {
  StatusCode?: number;
}

interface DockerModemOperations {
  demuxStream(stream: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): void;
  followProgress(
    stream: NodeJS.ReadableStream,
    completed: (error: Error | null, output: readonly unknown[]) => void,
  ): void;
}

function dockerModem(docker: Docker): DockerModemOperations {
  return docker.modem as unknown as DockerModemOperations;
}

function normalizeGuestPath(value: string): string {
  const normalized = path.posix.normalize(value);
  if (!normalized.startsWith("/") || normalized !== value) throw new Error(`Invalid sandbox guest path: ${value}`);
  return normalized;
}

function serializeTmpfsOptions(entry: { sizeMiB: number; mode: string; noSuid: boolean; noDevice: boolean }): string {
  return [
    "rw",
    entry.noSuid ? "nosuid" : undefined,
    entry.noDevice ? "nodev" : undefined,
    `size=${entry.sizeMiB}m`,
    `mode=${entry.mode.slice(1)}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(",");
}

function dockerSignal(signal: SeneraTerminalSignal): string {
  return { interrupt: "SIGINT", terminate: "SIGTERM", kill: "SIGKILL" }[signal];
}

function compareDockerApiVersions(left: string, right: string): number {
  const parse = (value: string): [number, number] => {
    const [major = "0", minor = "0"] = value.split(".");
    return [Number(major), Number(minor)];
  };
  const [leftMajor, leftMinor] = parse(left);
  const [rightMajor, rightMinor] = parse(right);
  return leftMajor === rightMajor ? leftMinor - rightMinor : leftMajor - rightMajor;
}

function requireImageReference(reference: string): string {
  const normalized = reference.trim();
  if (!normalized || /\s/u.test(normalized)) throw new Error("Docker sandbox runtime image reference is invalid.");
  return normalized;
}

function dockerStatusCode(error: unknown): number | undefined {
  return isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : undefined;
}

function ignoreMissingDockerResource(error: unknown): void {
  if (dockerStatusCode(error) !== 404) throw error;
}

function ignoreStoppedDockerContainer(error: unknown): void {
  const status = dockerStatusCode(error);
  if (status !== 304 && status !== 404 && status !== 409) throw error;
}

function dockerOperationError(operation: string, error: unknown): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  return new Error(`Docker Engine sandbox operation failed (${operation}): ${cause.message}`, { cause });
}

function resolveRuntimeName(
  contract: ResolvedAgentDockerEngineRuntimeContract,
  configuredName: string | undefined,
): string | undefined {
  if (contract.contract.runtime.strategy === "daemon-default") {
    if (configuredName?.trim()) {
      throw new Error("The daemon-default Docker Engine sandbox provider cannot override the daemon runtime.");
    }
    return undefined;
  }
  return configuredName?.trim() || contract.contract.runtime.name;
}

function onceAsync(operation: () => Promise<void>): () => Promise<void> {
  let promise: Promise<void> | undefined;
  return () => (promise ??= operation());
}
