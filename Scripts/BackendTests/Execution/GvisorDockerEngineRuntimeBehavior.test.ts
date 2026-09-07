import path from "node:path";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import { describe, expect, test, vi } from "vitest";
import {
  AgentDockerEngineRuntime,
  resolveAgentDockerEngineSandboxProvider,
} from "../../../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntime.js";
import {
  readAgentDockerEngineRuntimeContract,
  type AgentDockerEngineSandboxProvider,
  type ResolvedAgentDockerEngineRuntimeContract,
} from "../../../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntimeContract.js";
import { AgentSandboxRuntimeImageLabels } from "../../../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";

describe("Docker Engine sandbox runtime", () => {
  test("uses the registered runsc runtime for the gVisor provider", async () => {
    const fixture = createRuntimeFixture("gvisor");
    await expect(fixture.runtime.probe()).resolves.toMatchObject({
      provider: "gvisor",
      runtimeName: "runsc",
      imageReady: true,
    });

    await executeProbeCommand(fixture.runtime, fixture.resolved);

    expect(fixture.created).toMatchObject({
      name: "contract-sandbox",
      Image: fixture.imageReference,
      Entrypoint: ["/usr/local/bin/node"],
      Cmd: ["--version"],
      WorkingDir: fixture.resolved.contract.guest.workspaceRoot,
      HostConfig: {
        Runtime: "runsc",
        NetworkMode: "none",
        ReadonlyRootfs: true,
        Init: true,
        CapDrop: ["ALL"],
      },
      Env: expect.arrayContaining([
        "GIT_CONFIG_COUNT=1",
        "GIT_CONFIG_KEY_0=safe.directory",
        `GIT_CONFIG_VALUE_0=${fixture.resolved.contract.guest.workspaceRoot}`,
      ]),
    });
    expect(fixture.remove).toHaveBeenCalledWith({ force: true });
  });

  test("omits the runtime override for the hardened daemon-default provider", async () => {
    const fixture = createRuntimeFixture("docker-engine");
    await expect(fixture.runtime.probe()).resolves.toMatchObject({
      provider: "docker-engine",
      imageReady: true,
    });

    await executeProbeCommand(fixture.runtime, fixture.resolved);

    expect(fixture.created?.HostConfig).not.toHaveProperty("Runtime");
    expect(fixture.created).toMatchObject({
      Labels: {
        "ai.senera.managed": "true",
        "ai.senera.sandbox-provider": "docker-engine",
      },
      HostConfig: {
        NetworkMode: "none",
        ReadonlyRootfs: true,
        Init: true,
        SecurityOpt: ["no-new-privileges:true"],
        CapDrop: ["ALL"],
      },
      Env: expect.arrayContaining([
        "GIT_CONFIG_COUNT=1",
        "GIT_CONFIG_KEY_0=safe.directory",
        `GIT_CONFIG_VALUE_0=${fixture.resolved.contract.guest.workspaceRoot}`,
      ]),
    });
  });

  test("selects gVisor when runsc is registered and daemon-default otherwise", async () => {
    const dockerWithRunsc = {
      info: vi.fn(async () => ({ OSType: "linux", Runtimes: { runc: {}, runsc: {} } })),
    } as unknown as Docker;
    const dockerWithoutRunsc = {
      info: vi.fn(async () => ({ OSType: "linux", Runtimes: { runc: {} } })),
    } as unknown as Docker;

    await expect(
      resolveAgentDockerEngineSandboxProvider({ docker: dockerWithRunsc, preference: "auto" }),
    ).resolves.toMatchObject({
      provider: "gvisor",
    });
    await expect(
      resolveAgentDockerEngineSandboxProvider({ docker: dockerWithoutRunsc, preference: "auto" }),
    ).resolves.toMatchObject({
      provider: "docker-engine",
    });
    await expect(
      resolveAgentDockerEngineSandboxProvider({ docker: dockerWithoutRunsc, preference: "gvisor" }),
    ).rejects.toThrow("registered-runsc");
  });

  test("requires the deployment to preload the declared runtime image", async () => {
    const resolved = readAgentDockerEngineRuntimeContract("docker-engine", "x64");
    const imageReference = "ghcr.io/example/senera-sandbox-runtime:verified";
    const missing = Object.assign(new Error("image missing"), { statusCode: 404 });
    const pull = vi.fn();
    const docker = {
      version: vi.fn(async () => ({ ApiVersion: resolved.contract.engine.minimumApiVersion })),
      info: vi.fn(async () => ({ OSType: "linux", Runtimes: { runc: {} } })),
      getImage: vi.fn(() => ({ inspect: vi.fn(async () => Promise.reject(missing)) })),
      pull,
      createContainer: vi.fn(),
    } as unknown as Docker;
    const runtime = new AgentDockerEngineRuntime({
      docker,
      workspace: { kind: "volume", volumeName: "senera-data", guestRoot: resolved.contract.guest.workspaceRoot },
      copySourceRoots: [path.resolve("workspace")],
      runtimeContract: resolved,
      imageReference,
      pullPolicy: "never",
    });
    await expect(runtime.probe()).resolves.toMatchObject({ image: imageReference, imageReady: false });
    await expect(runtime.prepare()).rejects.toThrow("unavailable under pull policy never");
    expect(pull).not.toHaveBeenCalled();
  });

  test("rejects a preloaded image that does not match the declared distribution", async () => {
    const resolved = readAgentDockerEngineRuntimeContract("docker-engine", "x64");
    const imageReference = "ghcr.io/example/senera-sandbox-runtime:verified";
    const docker = {
      version: vi.fn(async () => ({ ApiVersion: resolved.contract.engine.minimumApiVersion })),
      info: vi.fn(async () => ({ OSType: "linux", Runtimes: { runc: {} } })),
      getImage: vi.fn(() => ({
        inspect: vi.fn(async () => ({
          Config: {
            Labels: {
              ...runtimeImageLabels(resolved),
              [AgentSandboxRuntimeImageLabels.distributionVersion]: "unexpected",
            },
          },
        })),
      })),
    } as unknown as Docker;
    const runtime = new AgentDockerEngineRuntime({
      docker,
      workspace: { kind: "volume", volumeName: "senera-data", guestRoot: resolved.contract.guest.workspaceRoot },
      copySourceRoots: [path.resolve("workspace")],
      runtimeContract: resolved,
      imageReference,
      pullPolicy: "never",
    });

    await expect(runtime.probe()).rejects.toThrow("runtime image identity is invalid");
  });
});

function createRuntimeFixture(provider: AgentDockerEngineSandboxProvider): {
  runtime: AgentDockerEngineRuntime;
  resolved: ResolvedAgentDockerEngineRuntimeContract;
  imageReference: string;
  remove: ReturnType<typeof vi.fn>;
  readonly created: Docker.ContainerCreateOptions | undefined;
} {
  const resolved = readAgentDockerEngineRuntimeContract(provider, "x64");
  const remove = vi.fn(async () => undefined);
  let created: Docker.ContainerCreateOptions | undefined;
  const docker = {
    version: vi.fn(async () => ({ ApiVersion: resolved.contract.engine.minimumApiVersion })),
    info: vi.fn(async () => ({ OSType: "linux", Runtimes: { runsc: {}, runc: {} } })),
    getImage: vi.fn(() => ({
      inspect: vi.fn(async () => ({ Id: "image", Config: { Labels: runtimeImageLabels(resolved) } })),
    })),
    createContainer: vi.fn(async (options: Docker.ContainerCreateOptions) => {
      created = options;
      const attached = new PassThrough();
      return {
        id: "sandbox-id",
        attach: vi.fn(async () => attached),
        start: vi.fn(async () => attached.end()),
        wait: vi.fn(async () => ({ StatusCode: 0 })),
        kill: vi.fn(async () => undefined),
        remove,
        putArchive: vi.fn(async () => undefined),
      };
    }),
    modem: {
      demuxStream: (stream: PassThrough, stdout: PassThrough) => stream.pipe(stdout),
    },
  } as unknown as Docker;
  const workspaceRoot = path.resolve("workspace");
  const imageReference = "ghcr.io/example/senera-sandbox-runtime:verified";
  const runtime = new AgentDockerEngineRuntime({
    docker,
    workspace: { kind: "bind", sourcePath: workspaceRoot, guestRoot: resolved.contract.guest.workspaceRoot },
    copySourceRoots: [workspaceRoot],
    runtimeContract: resolved,
    imageReference,
    pullPolicy: "never",
    containerNameFactory: () => "contract-sandbox",
  });
  return {
    runtime,
    resolved,
    imageReference,
    remove,
    get created() {
      return created;
    },
  };
}

async function executeProbeCommand(
  runtime: AgentDockerEngineRuntime,
  resolved: ResolvedAgentDockerEngineRuntimeContract,
): Promise<void> {
  await runtime.prepare();
  const process = await runtime.start({
    requestId: "request-1",
    command: "/usr/local/bin/node",
    arguments: ["--version"],
    cwd: resolved.contract.guest.workspaceRoot,
    environment: {
      GIT_CONFIG_COUNT: "99",
      GIT_CONFIG_KEY_0: "safe.directory",
      GIT_CONFIG_VALUE_0: "*",
    },
    interactive: false,
    workspaceMount: "readonly",
    network: "disabled",
    rootfsCopies: [],
    writableMounts: [],
    limits: { cpus: 1, memoryMiB: 256, processCount: 64, timeoutMs: 10_000 },
  });
  await expect(process.completion).resolves.toEqual({ exitCode: 0, signal: null });
  await process.cleanup();
}

function runtimeImageLabels(resolved: ResolvedAgentDockerEngineRuntimeContract): Record<string, string> {
  return {
    [AgentSandboxRuntimeImageLabels.distributionId]: resolved.distribution.id,
    [AgentSandboxRuntimeImageLabels.distributionVersion]: resolved.distribution.version,
    [AgentSandboxRuntimeImageLabels.target]: resolved.distribution.target,
    [AgentSandboxRuntimeImageLabels.sourceImage]: resolved.image.sourceImage,
  };
}
