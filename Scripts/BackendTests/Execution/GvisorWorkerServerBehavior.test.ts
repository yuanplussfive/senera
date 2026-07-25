import net from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { AgentGvisorWorkerSocketClient } from "../../../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorWorkerClient.js";
import {
  AgentGvisorWorkerFrameDecoder,
  encodeAgentGvisorWorkerFrame,
} from "../../../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorWorkerFraming.js";
import { AgentGvisorWorkerServer } from "../../../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorWorkerServer.js";
import type {
  AgentGvisorDockerProcess,
  AgentGvisorDockerRuntime,
} from "../../../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorDockerRuntime.js";
import type { AgentGvisorExecutionRequest } from "../../../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorWorkerProtocol.js";

describe("gVisor worker server", () => {
  test("keeps the execution socket open for streamed input after the start frame", async () => {
    const fixture = await createWorkerFixture();
    try {
      const client = new AgentGvisorWorkerSocketClient({ socketPath: fixture.socketPath });
      await expect(client.probe({ timeoutMs: 1_000 })).resolves.toMatchObject({
        isolation: "gvisor",
        imageReady: true,
      });
      const preparationProgress: unknown[] = [];
      await expect(
        client.prepare({
          timeoutMs: 1_000,
          onProgress: (progress) => preparationProgress.push(progress),
        }),
      ).resolves.toBeUndefined();
      expect(preparationProgress).toEqual([
        {
          stage: "verifying_archive",
          item: "sandbox.oci.tar.gz",
          downloadedBytes: 1024,
          totalBytes: 4096,
        },
      ]);

      const process = await client.start(createExecutionRequest());
      await process.write(Buffer.from("first input"));
      await process.endInput();
      await fixture.runtime.waitForInputClosed();
      fixture.runtime.complete({ exitCode: 0, signal: null });

      await expect(readEvents(process.events)).resolves.toEqual([{ kind: "exit", code: 0, signal: null }]);
      expect(fixture.runtime.input).toBe("first input");
      expect(fixture.runtime.preparations).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  test("rejects an invalid first worker message without starting an execution", async () => {
    const fixture = await createWorkerFixture();
    try {
      const socket = net.createConnection(fixture.socketPath);
      await once(socket, "connect");
      const decoder = new AgentGvisorWorkerFrameDecoder();
      const response = new Promise<unknown>((resolve, reject) => {
        socket.on("data", (chunk) => {
          try {
            const [message] = decoder.push(Buffer.from(chunk));
            if (message) resolve(message);
          } catch (error) {
            reject(error);
          }
        });
        socket.once("error", reject);
      });
      socket.write(encodeAgentGvisorWorkerFrame({ type: "input", data: "aWdub3JlZA==" }));

      await expect(response).resolves.toMatchObject({ type: "error", code: "invalid_worker_protocol" });
      expect(fixture.runtime.started).toBe(0);
      socket.destroy();
    } finally {
      await fixture.close();
    }
  });

  test("reports the provider locked by the worker runtime", async () => {
    const fixture = await createWorkerFixture("docker-engine");
    try {
      const client = new AgentGvisorWorkerSocketClient({ socketPath: fixture.socketPath });
      await expect(client.probe({ timeoutMs: 1_000 })).resolves.toMatchObject({
        isolation: "docker-engine",
        imageReady: true,
      });
    } finally {
      await fixture.close();
    }
  });
});

async function createWorkerFixture(provider: "gvisor" | "docker-engine" = "gvisor"): Promise<{
  socketPath: string;
  runtime: RecordingRuntime;
  close(): Promise<void>;
}> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "senera-gvisor-worker-"));
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\senera-gvisor-worker-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
      : path.join(temporaryRoot, "worker.sock");
  const runtime = new RecordingRuntime(provider);
  const server = new AgentGvisorWorkerServer({ socketPath, runtime });
  await server.start();
  return {
    socketPath,
    runtime,
    close: async () => {
      await server.close();
      await rm(temporaryRoot, { recursive: true, force: true });
    },
  };
}

function createExecutionRequest(): AgentGvisorExecutionRequest {
  return {
    requestId: "request-1",
    image: "senera.local/node:latest",
    command: "/bin/sh",
    arguments: ["-lc", "cat"],
    cwd: "/workspace",
    environment: {},
    interactive: true,
    workspaceMount: "readonly",
    network: "disabled",
    rootfsCopies: [],
    writableMounts: [],
    limits: { cpus: 1, memoryMiB: 256, processCount: 64, timeoutMs: 10_000 },
  };
}

async function readEvents(events: AsyncIterable<unknown>): Promise<unknown[]> {
  const result: unknown[] = [];
  for await (const event of events) result.push(event);
  return result;
}

class RecordingRuntime implements AgentGvisorDockerRuntime {
  input = "";
  preparations = 0;
  started = 0;
  private completionResolve: ((value: { exitCode: number | null; signal: string | null }) => void) | undefined;
  private inputClosed: Promise<void> | undefined;

  constructor(private readonly selectedProvider: "gvisor" | "docker-engine") {}

  provider() {
    return this.selectedProvider;
  }

  async probe() {
    return {
      provider: this.provider(),
      runtimeName: "runsc",
      contractId: `senera-${this.selectedProvider}-oci-runtime`,
      image: "senera.local/node:latest",
      imageReady: true,
    };
  }

  async prepare(input?: Parameters<AgentGvisorDockerRuntime["prepare"]>[0]): Promise<void> {
    this.preparations += 1;
    input?.onProgress?.({
      stage: "verifying_archive",
      item: "sandbox.oci.tar.gz",
      downloadedBytes: 1024,
      totalBytes: 4096,
    });
  }

  async start(_request: AgentGvisorExecutionRequest): Promise<AgentGvisorDockerProcess> {
    this.started += 1;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdin.on("data", (chunk: Buffer) => {
      this.input += chunk.toString("utf8");
    });
    this.inputClosed = once(stdin, "end").then(() => undefined);
    return {
      id: "sandbox-1",
      stdin,
      stdout,
      stderr,
      completion: new Promise((resolve) => {
        this.completionResolve = resolve;
      }),
      terminate: async () => undefined,
      cleanup: async () => undefined,
    };
  }

  async waitForInputClosed(): Promise<void> {
    await this.inputClosed;
  }

  complete(result: { exitCode: number | null; signal: string | null }): void {
    this.completionResolve?.(result);
  }
}
