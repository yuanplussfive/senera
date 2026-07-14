import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { AgentApprovalRuntime } from "../../../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import { AgentConfigService } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentLogger } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentLoop } from "../../../Source/AgentSystem/Loop/AgentLoop.js";
import { AgentModelEndpointClient } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelEndpointClient.js";
import { AgentSystemRuntime } from "../../../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { AgentSandboxRuntimeService } from "../../../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";
import { AgentSessionManager } from "../../../Source/AgentSystem/Session/AgentSessionManager.js";
import { InMemorySessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";
import { AgentUserProfileManager } from "../../../Source/AgentSystem/Session/AgentUserProfile.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentWebSocketServer } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";
import { AgentProtocolE2eClient } from "../AgentProtocol/AgentProtocolE2eHarness.js";

export const RealRuntimeE2eValues = {
  FinalAnswer: "真实运行时已完成工具检索。",
  ModelId: "senera-runtime-e2e",
  RequestInput: "请调用工具确认当前是否具备 shell 命令能力。",
  ToolName: "ToolSearchTool",
} as const;

const PlannerStages = {
  AuditToolRisk: "auditToolRisk",
  FillPiToolArguments: "fillPiToolArguments",
  RouteInteraction: "routeInteraction",
  SelectPiAction: "selectPiAction",
  UnderstandUserTurn: "understandUserTurn",
} as const;

type PlannerStage = (typeof PlannerStages)[keyof typeof PlannerStages];

export interface RealRuntimeE2eHarness {
  readonly client: AgentProtocolE2eClient;
  readonly modelServer: FakePlannerModelServer;
  readonly websocketUrl: string;
  stop(): Promise<void>;
}

export async function createRealRuntimeE2eHarness(): Promise<RealRuntimeE2eHarness> {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "senera-runtime-e2e-"));
  const modelServer = await FakePlannerModelServer.start();
  try {
    const pluginRoot = await prepareRuntimePlugins(workspaceRoot);
    const config = createRuntimeConfig({
      modelBaseUrl: modelServer.baseUrl,
      pluginRoot,
      serverPort: await reserveLoopbackPort(),
    });
    const configPath = path.join(workspaceRoot, "senera.config.json");
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const configService = new AgentConfigService({
      workspaceRoot,
      source: {
        kind: "json",
        configPath,
      },
    });
    const configSnapshot = () => configService.snapshot().value;
    const approvalRuntime = new AgentApprovalRuntime();
    const runtime = AgentSystemRuntime.fromConfig({
      workspaceRoot,
      config,
      approvalRuntime,
      logger: new AgentLogger(),
    });
    const repository = new InMemorySessionRepository();
    const sessionManager = new AgentSessionManager({
      approvalRuntime,
      store: new AgentSessionStore({ repository }),
      piSessions: runtime.piSessionRegistry,
      loopFactory: (modelProviderId) =>
        new AgentLoop({
          runtime,
          model: new AgentModelEndpointClient(config, modelProviderId),
        }),
    });
    const sandboxRuntimeService = new AgentSandboxRuntimeService({ workspaceRoot, configSnapshot });
    sandboxRuntimeService.markFallback(new Error("Runtime E2E uses deterministic host capabilities."));
    const server = new AgentWebSocketServer({
      config,
      configService,
      configSnapshot,
      workspaceRoot,
      sessionManager,
      userProfileManager: new AgentUserProfileManager(repository),
      approvalRuntime,
      sandboxRuntimeService,
      logger: new AgentLogger(),
    });
    server.start();
    const websocketUrl = `ws://127.0.0.1:${config.Defaults!.Server!.Port}`;
    const client = await AgentProtocolE2eClient.connect(websocketUrl);

    return {
      client,
      modelServer,
      websocketUrl,
      stop: async () => {
        client.close();
        server.stop();
        runtime.close();
        configService.close();
        repository.close();
        await modelServer.stop();
        removeTemporaryWorkspace(workspaceRoot);
      },
    };
  } catch (error) {
    await modelServer.stop();
    removeTemporaryWorkspace(workspaceRoot);
    throw error;
  }
}

export class FakePlannerModelServer {
  readonly stages: PlannerStage[] = [];
  private selectPiActionCount = 0;

  private constructor(
    private readonly server: http.Server,
    readonly baseUrl: string,
  ) {}

  static async start(): Promise<FakePlannerModelServer> {
    const context: { instance?: FakePlannerModelServer } = {};
    const server = http.createServer((request, response) => {
      void context.instance?.handle(request, response);
    });
    await listenLoopback(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to resolve fake planner model server address.");
    }
    context.instance = new FakePlannerModelServer(server, `http://127.0.0.1:${address.port}/v1`);
    return context.instance;
  }

  count(stage: PlannerStage): number {
    return this.stages.filter((candidate) => candidate === stage).length;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const payload = await readJsonBody(request);
    const stage = detectPlannerStage(payload);
    if (!stage) {
      response.writeHead(422, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Unknown deterministic planner stage." } }));
      return;
    }
    this.stages.push(stage);
    const output = this.outputFor(stage);
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream; charset=utf-8",
    });
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(output) } }] })}\n\ndata: [DONE]\n\n`,
    );
  }

  private outputFor(stage: PlannerStage): unknown {
    const outputs: Record<Exclude<PlannerStage, "selectPiAction">, () => unknown> = {
      [PlannerStages.UnderstandUserTurn]: () => ({
        rawUserTurn: RealRuntimeE2eValues.RequestInput,
        standaloneRequest: RealRuntimeE2eValues.RequestInput,
        contextMode: "None",
        contextBasis: "",
        missingContext: "",
      }),
      [PlannerStages.RouteInteraction]: () => ({
        mode: "ToolAgentLoop",
        objective: "确认当前注册的 shell 命令能力",
        needsFreshEvidence: true,
        needsWorkspaceRead: false,
        needsSideEffect: false,
        risk: "read",
        preferredTools: [RealRuntimeE2eValues.ToolName],
        discoveryQueries: [],
        reason: "需要通过已注册工具目录确认能力。",
      }),
      [PlannerStages.FillPiToolArguments]: () => ({
        arguments: { query: "shell command", includeLoaded: true },
        missingInputs: [],
        assumptions: [],
      }),
      [PlannerStages.AuditToolRisk]: () => ({
        decision: "Allow",
        riskLevel: "Low",
        confidence: 1,
        tripwire: false,
        reason: "Deterministic read-only E2E tool call.",
        matchedConcerns: [],
      }),
    };
    if (stage !== PlannerStages.SelectPiAction) return outputs[stage]();

    this.selectPiActionCount += 1;
    return this.selectPiActionCount === 1
      ? {
          kind: "CallTools",
          preface: "我先检查当前注册的命令工具能力。",
          calls: [
            {
              toolName: RealRuntimeE2eValues.ToolName,
              purpose: "确认是否存在 shell 命令执行能力",
              required: true,
              argumentHints: { query: "shell command", includeLoaded: true },
            },
          ],
        }
      : {
          kind: "FinalAnswer",
          answer: RealRuntimeE2eValues.FinalAnswer,
        };
  }
}

async function prepareRuntimePlugins(workspaceRoot: string): Promise<string> {
  const targetRoot = path.join(workspaceRoot, "SystemPlugins");
  const sourceRoot = path.resolve(process.cwd(), "System", "Plugins");
  await fs.mkdir(targetRoot, { recursive: true });
  await Promise.all(
    ["AgentTemplatePlugin", "AgentToolSearchPlugin", "AskUserToolPlugin"].map((pluginName) =>
      fs.cp(path.join(sourceRoot, pluginName), path.join(targetRoot, pluginName), { recursive: true }),
    ),
  );
  return targetRoot;
}

function createRuntimeConfig(input: {
  modelBaseUrl: string;
  pluginRoot: string;
  serverPort: number;
}): AgentSystemConfig {
  return {
    Defaults: {
      Server: {
        Host: "127.0.0.1",
        Port: input.serverPort,
        HotReload: false,
        RequestMaxBytes: 1_048_576,
      },
      Persistence: { Kind: "memory" },
      PluginRoots: { System: [input.pluginRoot], User: [] },
      AgentLoop: { LoadedTools: "all", PiSessions: { RootDir: ".senera/pi-sessions" } },
      ToolSearch: { Memory: { Kind: "memory" } },
      ToolLearning: { Enabled: false },
      SandboxRuntime: {
        BaseDir: ".senera/sandbox-runtime",
        BundleDir: ".senera/sandbox-bundles",
        ImportBundlesOnStartup: false,
        Images: [],
      },
      Presets: {
        Enabled: false,
        RootDir: ".senera/presets",
        StateFile: ".senera/presets-state.json",
      },
    },
    ConfigStore: { Enabled: false },
    DefaultModelProviderId: "runtime-e2e",
    ModelProviderEndpoints: [
      {
        Id: "runtime-e2e",
        BaseUrl: input.modelBaseUrl,
        ApiKey: "runtime-e2e-key",
      },
    ],
    ModelProviders: [
      {
        Id: "runtime-e2e",
        ProviderId: "runtime-e2e",
        Endpoint: "ChatCompletions",
        Model: RealRuntimeE2eValues.ModelId,
        Stream: true,
        MaxNetworkRetries: 0,
      },
    ],
  };
}

function detectPlannerStage(payload: unknown): PlannerStage | undefined {
  const serialized = JSON.stringify(payload);
  return Object.values(PlannerStages).find((stage) => serialized.includes(stage));
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function listenLoopback(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function reserveLoopbackPort(): Promise<number> {
  const server = net.createServer();
  await listenLoopback(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to reserve a loopback port.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function removeTemporaryWorkspace(workspaceRoot: string): void {
  rmSync(workspaceRoot, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 50,
  });
}
