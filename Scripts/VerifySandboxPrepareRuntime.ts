import assert from "node:assert/strict";
import { PassThrough, type Readable } from "node:stream";
import Docker from "dockerode";
import { prepareSandboxRuntime } from "../Build/PrepareSandboxRuntime.js";
import {
  AgentSandboxRuntimeImageLabels,
  readAgentSandboxDistributionContract,
  resolveAgentSandboxDistributionTarget,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";

const distribution = readAgentSandboxDistributionContract();
const target = resolveAgentSandboxDistributionTarget(distribution);
const labels = {
  [AgentSandboxRuntimeImageLabels.distributionId]: distribution.id,
  [AgentSandboxRuntimeImageLabels.distributionVersion]: distribution.version,
  [AgentSandboxRuntimeImageLabels.target]: process.arch,
  [AgentSandboxRuntimeImageLabels.sourceImage]: target.sourceImage,
};
const builtTags: string[] = [];
const appliedTags: string[] = [];
const probeCommands: string[] = [];
const progress: string[] = [];

const docker = {
  info: async () => ({ OSType: "linux", Runtimes: { runc: {} } }),
  version: async () => ({ ApiVersion: "1.50" }),
  buildImage: async (context: Readable, options: { t?: string }) => {
    context.resume();
    if (options.t) builtTags.push(options.t);
    const stream = new PassThrough();
    stream.end();
    return stream;
  },
  getImage: (reference: string) => ({
    tag: async ({ repo, tag }: { repo: string; tag: string }) => {
      appliedTags.push(`${reference}->${repo}:${tag}`);
    },
    inspect: async () => ({ Config: { Labels: labels } }),
  }),
  createContainer: async (options: Docker.ContainerCreateOptions) => {
    probeCommands.push([...(options.Entrypoint ?? []), ...(options.Cmd ?? [])].join(" "));
    return {
      start: async () => undefined,
      wait: async () => ({ StatusCode: 0 }),
      remove: async () => undefined,
    };
  },
  modem: {
    followProgress: (
      _stream: NodeJS.ReadableStream,
      completed: (error: Error | null, output: readonly unknown[]) => void,
      report?: (event: unknown) => void,
    ) => {
      report?.({ stream: "sandbox image built" });
      completed(null, []);
    },
  },
} as unknown as Docker;

const prepared = await prepareSandboxRuntime({
  workspaceRoot: process.cwd(),
  docker,
  log: (message) => progress.push(message),
});

assert.equal(prepared.provider, "docker-engine");
assert.deepEqual(prepared.images, [target.runtimeImage, target.registryImage]);
assert.deepEqual(
  prepared.probes,
  target.probes.map((probe) => probe.id),
);
assert.deepEqual(builtTags, [target.runtimeImage]);
assert.deepEqual(appliedTags, [`${target.runtimeImage}->${splitTag(target.registryImage).join(":")}`]);
assert.deepEqual(
  probeCommands,
  target.probes.map((probe) => [probe.command, ...probe.arguments].join(" ")),
);
assert.ok(progress.some((message) => message.includes("sandbox image built")));
await assert.rejects(
  () => prepareSandboxRuntime({ workspaceRoot: process.cwd(), architecture: "unsupported", docker }),
  /does not publish a runtime image/u,
);

console.log("Sandbox prepare runtime verification passed.");

function splitTag(reference: string): [string, string] {
  const separator = reference.lastIndexOf(":");
  assert.ok(separator > reference.lastIndexOf("/"));
  return [reference.slice(0, separator), reference.slice(separator + 1)];
}
