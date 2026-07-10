import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { WebSocket } from "ws";
import { AgentWebSocketServer } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";
import type { AgentWebSocketRequest } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";
import { AgentSessionManager } from "../../../Source/AgentSystem/Session/AgentSessionManager.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";
import { InMemorySessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentUserProfileManager } from "../../../Source/AgentSystem/Session/AgentUserProfile.js";
import { AgentApprovalRuntime } from "../../../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import { AgentSandboxRuntimeService } from "../../../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";
import { AgentLogger } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEventCatalog.js";
import type { AgentDomainEvent, AgentEventEnvelope } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentCompletedRunResult } from "../../../Source/AgentSystem/Runtime/AgentExecutionProjector.js";
import type { AgentRunRequest } from "../../../Source/AgentSystem/Loop/AgentLoop.js";

export interface AgentProtocolE2eHarness {
  readonly workspaceRoot: string;
  readonly websocketUrl: string;
  readonly client: AgentProtocolE2eClient;
  stop(): void;
}

type ScriptedLoopHandler = (request: AgentRunRequest) => Promise<AgentCompletedRunResult>;

export async function createAgentProtocolE2eHarness(
  handler: ScriptedLoopHandler = defaultScriptedLoopHandler,
): Promise<AgentProtocolE2eHarness> {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "senera-e2e-"));
  const config = createE2eConfig(await reserveTcpPort());
  const repository = new InMemorySessionRepository();
  const store = new AgentSessionStore({ repository });
  const approvalRuntime = new AgentApprovalRuntime();
  const sandboxRuntimeService = new AgentSandboxRuntimeService({
    workspaceRoot,
    configSnapshot: () => config,
  });
  sandboxRuntimeService.markFallback(new Error("E2E intentionally runs without OS sandbox preparation."));

  const sessionManager = new AgentSessionManager({
    store,
    approvalRuntime,
    loopFactory: () => new ScriptedAgentLoop(handler),
  });
  const server = new AgentWebSocketServer({
    config,
    workspaceRoot,
    sessionManager,
    userProfileManager: new AgentUserProfileManager(repository),
    approvalRuntime,
    sandboxRuntimeService,
    logger: new AgentLogger(),
  });
  server.start();

  const websocketUrl = `ws://${config.Defaults?.Server?.Host}:${config.Defaults?.Server?.Port}`;
  const client = await AgentProtocolE2eClient.connect(websocketUrl);
  return {
    workspaceRoot,
    websocketUrl,
    client,
    stop: () => {
      client.close();
      server.stop();
      repository.close();
      rmSync(workspaceRoot, { recursive: true, force: true });
    },
  };
}

export class AgentProtocolE2eClient {
  private readonly events: AgentEventEnvelope[] = [];
  private readonly waiters = new Set<() => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => {
      this.events.push(JSON.parse(data.toString("utf8")) as AgentEventEnvelope);
      for (const notify of this.waiters) notify();
    });
  }

  static async connect(url: string): Promise<AgentProtocolE2eClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new AgentProtocolE2eClient(socket);
  }

  send(request: AgentWebSocketRequest): void {
    this.socket.send(JSON.stringify(request));
  }

  snapshot(): AgentEventEnvelope[] {
    return [...this.events];
  }

  close(): void {
    this.socket.close();
  }

  async waitForKinds(
    kinds: readonly string[],
    options: { timeoutMs?: number; afterSequence?: number } = {},
  ): Promise<AgentEventEnvelope[]> {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const matches = this.events.filter((event) =>
        event.sequence > (options.afterSequence ?? 0) && kinds.includes(event.kind));
      if (new Set(matches.map((event) => event.kind)).size === new Set(kinds).size) {
        return matches;
      }
      await this.waitForNextEvent(Math.max(1, deadline - Date.now()));
    }
    throw new Error(`Timed out waiting for events: ${kinds.join(", ")}`);
  }

  async waitForEvent(
    kind: string,
    predicate: (event: AgentEventEnvelope) => boolean = () => true,
    options: { timeoutMs?: number; afterSequence?: number } = {},
  ): Promise<AgentEventEnvelope> {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const found = this.events.find((event) =>
        event.sequence > (options.afterSequence ?? 0) && event.kind === kind && predicate(event));
      if (found) return found;
      await this.waitForNextEvent(Math.max(1, deadline - Date.now()));
    }
    throw new Error(`Timed out waiting for event: ${kind}`);
  }

  private async waitForNextEvent(timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(notify);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      const notify = () => done();
      this.waiters.add(notify);
    });
  }
}

class ScriptedAgentLoop {
  constructor(private readonly handler: ScriptedLoopHandler) {}

  async run(request: AgentRunRequest): Promise<AgentCompletedRunResult> {
    return this.handler(request);
  }
}

async function defaultScriptedLoopHandler(request: AgentRunRequest): Promise<AgentCompletedRunResult> {
  await emitAll(request, [
    {
      kind: AgentEventKinds.RunStarted,
      context: { requestId: request.requestId },
      data: { input: request.input },
    },
    {
      kind: AgentEventKinds.ModelStarted,
      context: { requestId: request.requestId, step: 1 },
      data: { model: "senera-e2e" },
    },
    {
      kind: AgentEventKinds.ModelDelta,
      context: { requestId: request.requestId, step: 1 },
      data: { text: `E2E response: ${request.input}` },
    },
    {
      kind: AgentEventKinds.AssistantMessageCreated,
      context: { requestId: request.requestId, step: 1 },
      data: {
        messageId: `${request.requestId}:assistant`,
        kind: "final_answer",
        content: `E2E response: ${request.input}`,
        terminal: true,
      },
    },
    {
      kind: AgentEventKinds.RunCompleted,
      context: { requestId: request.requestId },
      data: {},
    },
  ]);

  return {
    terminal: {
      kind: "FinalAnswer",
      content: `E2E response: ${request.input}`,
    },
    decisionXml: `<FinalAnswer><answer>E2E response: ${escapeXml(request.input)}</answer></FinalAnswer>`,
    conversationEntries: [],
    stepTraces: [
      {
        step: 1,
        seq: 1,
        kind: "answer",
        status: "done",
        title: "E2E scripted answer",
      },
    ],
  };
}

async function emitAll(
  request: AgentRunRequest,
  events: readonly AgentDomainEvent[],
): Promise<void> {
  for (const event of events) {
    await request.onEvent?.(event);
  }
}

function createE2eConfig(port: number): AgentSystemConfig {
  return {
    Defaults: {
      Server: {
        Host: "127.0.0.1",
        Port: port,
        HotReload: false,
        RequestMaxBytes: 1_048_576,
      },
      Persistence: {
        Kind: "memory",
      },
      Presets: {
        Enabled: true,
        RootDir: ".senera/presets",
        StateFile: ".senera/presets-state.json",
      },
      SandboxRuntime: {
        BaseDir: ".senera/sandbox-runtime",
        BundleDir: ".senera/sandbox-bundles",
        ImportBundlesOnStartup: false,
        Images: [],
      },
      PluginRoots: {
        System: [],
        User: [],
      },
    },
    DefaultModelProviderId: "e2e",
    ModelProviderEndpoints: [
      {
        Id: "e2e",
        BaseUrl: "http://127.0.0.1/e2e",
        ApiKey: "e2e",
      },
    ],
    ModelProviders: [
      {
        Id: "e2e",
        ProviderId: "e2e",
        Endpoint: "ChatCompletions",
        Model: "senera-e2e",
      },
    ],
  };
}

async function reserveTcpPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to reserve a TCP port.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
