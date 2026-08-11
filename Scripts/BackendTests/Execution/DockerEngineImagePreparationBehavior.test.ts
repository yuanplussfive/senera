import { PassThrough } from "node:stream";
import Docker from "dockerode";
import type { Headers as TarHeader } from "tar-fs";
import { describe, expect, test, vi } from "vitest";
import { normalizeSandboxBuildContextHeader } from "../../../Build/PrepareSandboxRuntime.js";
import { AgentSandboxRuntimeImageLabels } from "../../../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";
import { AgentDockerEngineRuntime } from "../../../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntime.js";
import { readAgentDockerEngineRuntimeContract } from "../../../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntimeContract.js";

describe("Docker Engine runtime image preparation", () => {
  test("normalizes Windows build-context permissions for Linux images", () => {
    expect(normalizeSandboxBuildContextHeader(tarHeader("directory", 0o666)).mode).toBe(0o755);
    expect(normalizeSandboxBuildContextHeader(tarHeader("file", 0o666)).mode).toBe(0o644);
    expect(normalizeSandboxBuildContextHeader(tarHeader("symlink", 0o777)).mode).toBe(0o777);
  });

  test.each(["always", "if-missing"] as const)("pulls and verifies the image under %s policy", async (pullPolicy) => {
    const fixture = createFixture({ imagePresent: pullPolicy === "always", pullPolicy });
    const progress: Array<{ stage: string; item?: string; completed?: number }> = [];

    await fixture.runtime.prepare({ onProgress: (event) => progress.push(event) });

    expect(fixture.pull).toHaveBeenCalledWith(fixture.imageReference);
    expect(fixture.probes).toEqual(fixture.resolved.image.probes.map((probe) => probe.id));
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "detecting_engine" }),
        expect.objectContaining({ stage: "pulling_image", item: fixture.imageReference }),
        expect.objectContaining({ stage: "verifying_image", item: fixture.imageReference }),
        expect.objectContaining({
          stage: "probing_toolchain",
          completed: fixture.resolved.image.probes.length,
        }),
      ]),
    );
  });

  test("does not pull a verified image under if-missing policy", async () => {
    const fixture = createFixture({ imagePresent: true, pullPolicy: "if-missing" });

    await fixture.runtime.prepare();

    expect(fixture.pull).not.toHaveBeenCalled();
    expect(fixture.probes).toHaveLength(fixture.resolved.image.probes.length);
  });

  test("names the failed toolchain probe and removes its container", async () => {
    const fixture = createFixture({ imagePresent: true, pullPolicy: "never", failingProbe: "rg" });

    await expect(fixture.runtime.prepare()).rejects.toThrow("toolchain probe rg exited with status 17");
    expect(fixture.remove).toHaveBeenCalledTimes(fixture.probes.length);
    expect(fixture.probes.at(-1)).toBe("rg");
  });
});

function createFixture(options: {
  imagePresent: boolean;
  pullPolicy: "always" | "if-missing" | "never";
  failingProbe?: string;
}) {
  const resolved = readAgentDockerEngineRuntimeContract("docker-engine", "x64");
  const imageReference = resolved.image.registryImage;
  const probes: string[] = [];
  let imagePresent = options.imagePresent;
  const pull = vi.fn(async () => {
    const stream = new PassThrough();
    stream.end();
    return stream;
  });
  const remove = vi.fn(async () => undefined);
  const docker = {
    version: vi.fn(async () => ({ ApiVersion: resolved.contract.engine.minimumApiVersion })),
    getImage: vi.fn(() => ({
      inspect: vi.fn(async () => {
        if (!imagePresent) throw Object.assign(new Error("missing"), { statusCode: 404 });
        return { Config: { Labels: runtimeImageLabels(resolved) } };
      }),
    })),
    pull,
    createContainer: vi.fn(async (request: Docker.ContainerCreateOptions) => {
      const invocation = normalizeContainerInvocation(request);
      const probe = resolved.image.probes.find(
        (candidate) =>
          candidate.command === invocation[0] &&
          candidate.arguments.length === invocation.length - 1 &&
          candidate.arguments.every((argument, index) => argument === invocation[index + 1]),
      );
      if (!probe) throw new Error(`Unexpected sandbox probe invocation: ${JSON.stringify(invocation)}`);
      const id = probe.id;
      probes.push(id);
      return {
        start: vi.fn(async () => undefined),
        wait: vi.fn(async () => ({ StatusCode: id === options.failingProbe ? 17 : 0 })),
        remove,
      };
    }),
    modem: {
      followProgress: (
        _stream: NodeJS.ReadableStream,
        completed: (error: Error | null, output: readonly unknown[]) => void,
        progress?: (event: unknown) => void,
      ) => {
        progress?.({ id: "layer", progressDetail: { current: 1024, total: 2048 } });
        imagePresent = true;
        completed(null, []);
      },
    },
  } as unknown as Docker;
  return {
    resolved,
    imageReference,
    probes,
    pull,
    remove,
    runtime: new AgentDockerEngineRuntime({
      docker,
      workspace: { kind: "bind", sourcePath: process.cwd() },
      copySourceRoots: [process.cwd()],
      runtimeContract: resolved,
      imageReference,
      pullPolicy: options.pullPolicy,
    }),
  };
}

function normalizeContainerInvocation(request: Docker.ContainerCreateOptions): string[] {
  return [...normalizeCommandPart(request.Entrypoint), ...normalizeCommandPart(request.Cmd)];
}

function normalizeCommandPart(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : [...value];
}

function tarHeader(type: TarHeader["type"], mode: number): TarHeader {
  return {
    name: type,
    mode,
    mtime: new Date(0),
    size: 0,
    type,
    uid: 0,
    gid: 0,
  };
}

function runtimeImageLabels(resolved: ReturnType<typeof readAgentDockerEngineRuntimeContract>): Record<string, string> {
  return {
    [AgentSandboxRuntimeImageLabels.distributionId]: resolved.distribution.id,
    [AgentSandboxRuntimeImageLabels.distributionVersion]: resolved.distribution.version,
    [AgentSandboxRuntimeImageLabels.target]: resolved.distribution.target,
    [AgentSandboxRuntimeImageLabels.sourceImage]: resolved.image.sourceImage,
  };
}
