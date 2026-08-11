import path from "node:path";
import process from "node:process";
import Docker from "dockerode";
import tar from "tar-fs";
import type { Headers as TarHeader } from "tar-fs";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";
import {
  readAgentSandboxDistributionContract,
  resolveAgentSandboxDistributionTarget,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";
import {
  AgentDockerEngineRuntime,
  resolveAgentDockerEngineSandboxProvider,
} from "../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntime.js";
import { readAgentDockerEngineRuntimeContract } from "../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntimeContract.js";
import {
  createAgentDockerEngineClient,
  resolveAgentDockerEngineEndpoint,
} from "../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineEndpoint.js";

const SandboxBuildContextEntries = [
  "Dockerfile.sandbox",
  "Build/SandboxRuntimeAptPackages.txt",
  "Packages/TerminalSidecar",
] as const;

export interface PrepareSandboxRuntimeOptions {
  workspaceRoot?: string;
  architecture?: string;
  engineEndpoint?: string;
  docker?: Docker;
  log?: (message: string) => void;
}

export interface PreparedSandboxRuntime {
  provider: "gvisor" | "docker-engine";
  engineEndpoint: string;
  images: readonly string[];
  probes: readonly string[];
}

export async function prepareSandboxRuntime(
  options: PrepareSandboxRuntimeOptions = {},
): Promise<PreparedSandboxRuntime> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const architecture = options.architecture ?? process.arch;
  const log = options.log ?? (() => undefined);
  const distribution = readAgentSandboxDistributionContract();
  const target = resolveAgentSandboxDistributionTarget(distribution, architecture);
  const engineEndpoint = resolveAgentDockerEngineEndpoint({ configuredEndpoint: options.engineEndpoint });
  const docker = options.docker ?? createAgentDockerEngineClient(engineEndpoint);
  const resolution = await resolveAgentDockerEngineSandboxProvider({ docker, preference: "auto" });
  const imageReferences = [...new Set([target.runtimeImage, target.registryImage])];

  log(`Building ${imageReferences[0]} for linux/${dockerArchitecture(architecture)}...`);
  const buildStream = await docker.buildImage(
    tar.pack(workspaceRoot, {
      entries: [...SandboxBuildContextEntries],
      map: normalizeSandboxBuildContextHeader,
    }),
    {
      dockerfile: SandboxBuildContextEntries[0],
      t: imageReferences[0],
      platform: `linux/${dockerArchitecture(architecture)}`,
      buildargs: {
        SENERA_SANDBOX_SOURCE_IMAGE: target.sourceImage,
        SENERA_SANDBOX_DISTRIBUTION_ID: distribution.id,
        SENERA_SANDBOX_DISTRIBUTION_VERSION: distribution.version,
        SENERA_SANDBOX_TARGET: architecture,
      },
    },
  );
  await followDockerProgress(docker, buildStream, log);

  for (const reference of imageReferences.slice(1)) {
    await docker.getImage(imageReferences[0]).tag(parseTaggedImageReference(reference));
  }

  const runtime = new AgentDockerEngineRuntime({
    docker,
    workspace: { kind: "bind", sourcePath: workspaceRoot },
    copySourceRoots: [workspaceRoot],
    provider: resolution.provider,
    runtimeContract: readAgentDockerEngineRuntimeContract(resolution.provider, architecture),
    imageReference: imageReferences[0],
    pullPolicy: "never",
  });
  await runtime.prepare({
    onProgress: (progress) => {
      if (progress.item) log(`${progress.stage}: ${progress.item}`);
    },
  });

  return {
    provider: resolution.provider,
    engineEndpoint,
    images: imageReferences,
    probes: target.probes.map((probe) => probe.id),
  };
}

export function normalizeSandboxBuildContextHeader(header: TarHeader): TarHeader {
  if (header.type === "directory") return { ...header, mode: 0o755 };
  if (header.type === "file") return { ...header, mode: 0o644 };
  return header;
}

function followDockerProgress(
  docker: Docker,
  stream: NodeJS.ReadableStream,
  log: (message: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    dockerModem(docker).followProgress(
      stream,
      (error) => (error ? reject(error) : resolve()),
      (event) => {
        if (!isRecord(event)) return;
        const message = typeof event.stream === "string" ? event.stream.trim() : undefined;
        if (message) log(message);
      },
    );
  });
}

function parseTaggedImageReference(reference: string): { repo: string; tag: string } {
  const separator = reference.lastIndexOf(":");
  if (separator <= reference.lastIndexOf("/")) throw new Error(`Runtime image reference has no tag: ${reference}`);
  return { repo: reference.slice(0, separator), tag: reference.slice(separator + 1) };
}

function dockerArchitecture(architecture: string): string {
  const values: Record<string, string> = { x64: "amd64", arm64: "arm64" };
  const value = values[architecture];
  if (!value) throw new Error(`Unsupported Docker sandbox architecture: ${architecture}`);
  return value;
}

interface DockerModem {
  followProgress(
    stream: NodeJS.ReadableStream,
    completed: (error: Error | null) => void,
    progress?: (event: unknown) => void,
  ): void;
}

function dockerModem(docker: Docker): DockerModem {
  return docker.modem as unknown as DockerModem;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (isMainModule(import.meta.url)) {
  const result = await prepareSandboxRuntime({ log: (message) => process.stdout.write(`${message}\n`) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
