import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveSandboxRuntimeConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import {
  resolveAgentDockerEngineEndpoint,
  resolveAgentSandboxWorkerEndpoint,
} from "../../../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineEndpoint.js";

describe("Docker Engine endpoint resolution", () => {
  test("uses the Docker Desktop named pipe on Windows and the daemon socket on Unix", () => {
    expect(resolveAgentDockerEngineEndpoint({ platform: "win32", environment: {} })).toBe("\\\\.\\pipe\\docker_engine");
    expect(resolveAgentDockerEngineEndpoint({ platform: "linux", environment: {} })).toBe("/var/run/docker.sock");
    expect(resolveAgentDockerEngineEndpoint({ platform: "darwin", environment: {} })).toBe("/var/run/docker.sock");
  });

  test("gives explicit configuration precedence over DOCKER_HOST and normalizes pipe paths", () => {
    expect(
      resolveAgentDockerEngineEndpoint({
        configuredEndpoint: "//./pipe/custom_engine",
        environment: { DOCKER_HOST: "tcp://engine.example:2375" },
        platform: "win32",
      }),
    ).toBe("\\\\.\\pipe\\custom_engine");
    expect(
      resolveAgentDockerEngineEndpoint({
        environment: { DOCKER_HOST: "tcp://engine.example:2375" },
        platform: "linux",
      }),
    ).toBe("tcp://engine.example:2375");
  });

  test("rejects unsupported Engine endpoint protocols", () => {
    expect(() =>
      resolveAgentDockerEngineEndpoint({ configuredEndpoint: "ssh://engine.example", environment: {} }),
    ).toThrow("Unsupported Docker Engine endpoint protocol");
  });
});

describe("sandbox Worker endpoint resolution", () => {
  const config = resolveSandboxRuntimeConfig({ ModelProviderEndpoints: [], ModelProviders: [] });
  const workspaceRoot = path.resolve("workspace-endpoint-fixture");

  test("creates a workspace-scoped Windows pipe without writing endpoint state", () => {
    const first = resolveAgentSandboxWorkerEndpoint(workspaceRoot, config, { platform: "win32", processId: 42 });
    const second = resolveAgentSandboxWorkerEndpoint(workspaceRoot, config, { platform: "win32", processId: 42 });
    expect(first).toBe(second);
    expect(first).toMatch(/^\\\\\.\\pipe\\senera-sandbox-[a-f0-9]{16}-42$/u);
  });

  test("resolves a relative Unix endpoint under the configured runtime root", () => {
    const endpoint = resolveAgentSandboxWorkerEndpoint(
      workspaceRoot,
      { ...config, BaseDir: ".runtime", Docker: { ...config.Docker, WorkerEndpoint: "control/worker.sock" } },
      { platform: "linux" },
    );
    expect(endpoint).toBe(path.resolve(workspaceRoot, ".runtime", "control", "worker.sock"));
  });

  test("requires configured Windows endpoints to be named pipes", () => {
    expect(() =>
      resolveAgentSandboxWorkerEndpoint(
        workspaceRoot,
        { ...config, Docker: { ...config.Docker, WorkerEndpoint: "worker.sock" } },
        { platform: "win32" },
      ),
    ).toThrow("must be a named pipe");
  });
});
