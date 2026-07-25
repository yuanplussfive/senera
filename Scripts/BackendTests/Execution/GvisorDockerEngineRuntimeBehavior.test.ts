import path from "node:path";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import { describe, expect, test, vi } from "vitest";
import {
  AgentGvisorDockerEngineRuntime,
  findImportedDockerImageId,
  resolveAgentDockerEngineSandboxProvider,
} from "../../../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorDockerRuntime.js";
import {
  readAgentDockerEngineRuntimeContract,
  type AgentDockerEngineSandboxProvider,
  type ResolvedAgentDockerEngineRuntimeContract,
} from "../../../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorRuntimeContract.js";

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
      Image: fixture.resolved.image.sourceImage,
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
    });
  });

  test("selects gVisor when runsc is registered and daemon-default otherwise", async () => {
    const dockerWithRunsc = { info: vi.fn(async () => ({ Runtimes: { runc: {}, runsc: {} } })) } as unknown as Docker;
    const dockerWithoutRunsc = { info: vi.fn(async () => ({ Runtimes: { runc: {} } })) } as unknown as Docker;

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

  test("resolves Docker Hub's normalized import reference to the Engine image id", () => {
    const sourceReference = readAgentDockerEngineRuntimeContract("docker-engine", "x64").image.sourceImage;
    const importedReference = sourceReference.replace("docker.io/library/", "");

    expect(
      findImportedDockerImageId(
        [{ Id: "sha256:image-config", RepoTags: [importedReference], RepoDigests: [] }],
        sourceReference,
      ),
    ).toBe("sha256:image-config");
    expect(() => findImportedDockerImageId([], sourceReference)).toThrow("imported 0 images");
  });
});

function createRuntimeFixture(provider: AgentDockerEngineSandboxProvider): {
  runtime: AgentGvisorDockerEngineRuntime;
  resolved: ResolvedAgentDockerEngineRuntimeContract;
  remove: ReturnType<typeof vi.fn>;
  readonly created: Docker.ContainerCreateOptions | undefined;
} {
  const resolved = readAgentDockerEngineRuntimeContract(provider, "x64");
  const remove = vi.fn(async () => undefined);
  let created: Docker.ContainerCreateOptions | undefined;
  const docker = {
    version: vi.fn(async () => ({ ApiVersion: resolved.contract.engine.minimumApiVersion })),
    info: vi.fn(async () => ({ Runtimes: { runsc: {}, runc: {} } })),
    getImage: vi.fn(() => ({ inspect: vi.fn(async () => ({ Id: "image" })) })),
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
  const runtime = new AgentGvisorDockerEngineRuntime({
    docker,
    workspace: { kind: "bind", sourcePath: workspaceRoot },
    copySourceRoots: [workspaceRoot],
    runtimeContract: resolved,
    containerNameFactory: () => "contract-sandbox",
  });
  return {
    runtime,
    resolved,
    remove,
    get created() {
      return created;
    },
  };
}

async function executeProbeCommand(
  runtime: AgentGvisorDockerEngineRuntime,
  resolved: ResolvedAgentDockerEngineRuntimeContract,
): Promise<void> {
  const process = await runtime.start({
    requestId: "request-1",
    image: resolved.image.sourceImage,
    command: "/usr/local/bin/node",
    arguments: ["--version"],
    cwd: resolved.contract.guest.workspaceRoot,
    environment: {},
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
