import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { AgentApprovalRuntime } from "../../../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import { AgentConfigService } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentLogger } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentCallbackRunEventWriter } from "../../../Source/AgentSystem/WebSocket/AgentCallbackRunEventWriter.js";
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
import { AgentProtocolIntegrationClient } from "../AgentProtocol/AgentProtocolIntegrationHarness.js";
import { createAgentRequestCancellationResource } from "../../../Source/AgentSystem/Session/AgentSessionRunResource.js";
import { AgentPiSessionMutationService } from "../../../Source/AgentSystem/Pi/AgentPiSessionMutationService.js";
import { AgentLocalAdminAccountStore } from "../../../Source/AgentSystem/Auth/AgentLocalAdminAccount.js";

export const RealRuntimeIntegrationValues = {
  DirectFinalAnswer: "真实运行时已直接完成回答。",
  DirectRequestInput: "请根据当前对话直接回答，不要调用工具。",
  FinalAnswer: "真实运行时已完成工具检索。",
  ModelId: "senera-runtime-e2e",
  RequestInput: "请调用工具确认当前是否具备 shell 命令能力。",
  ToolName: "ToolSearchTool",
} as const;

export const RealRuntimeIntegrationAdmin = {
  displayName: "Integration Owner",
  loginName: "owner",
  password: "a long integration password",
} as const;

const PlannerStages = {
  AuditToolRisk: "auditToolRisk",
  FillPiToolArguments: "fillPiToolArguments",
  GeneratePiFinalAnswer: "generatePiFinalAnswer",
  PrepareInteraction: "prepareInteraction",
  SelectPiAction: "selectPiAction",
} as const;

const RealRuntimePreparationFingerprint = "real-runtime-e2e-v1";

export type PlannerStage = (typeof PlannerStages)[keyof typeof PlannerStages];

export interface PlannerStagePause {
  readonly entered: Promise<void>;
  release(): void;
}

export interface RealRuntimeIntegrationHarness {
  readonly client: AgentProtocolIntegrationClient;
  readonly httpOrigin: string;
  readonly modelServer: FakePlannerModelServer;
  readonly workspaceRoot: string;
  readonly websocketUrl: string;
  stop(): Promise<void>;
}

export interface RealRuntimeIntegrationHarnessOptions {
  readonly authenticationMode?: "disabled" | "required";
  readonly authentication?: Partial<typeof RealRuntimeIntegrationAdmin>;
  readonly staticFrontendRoot?: string;
}

export async function createRealRuntimeIntegrationHarness(
  options: RealRuntimeIntegrationHarnessOptions = {},
): Promise<RealRuntimeIntegrationHarness> {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "senera-runtime-e2e-"));
  const modelServer = await FakePlannerModelServer.start();
  try {
    const pluginRoot = await prepareRuntimePlugins(workspaceRoot);
    const serverPort = await reserveLoopbackPort();
    const httpOrigin = `http://127.0.0.1:${serverPort}`;
    const authenticationMode = options.authenticationMode ?? (options.authentication ? "required" : "disabled");
    if (authenticationMode === "disabled" && options.authentication) {
      throw new Error("authentication credentials require authenticationMode=required.");
    }
    const authentication =
      authenticationMode === "required" ? { ...RealRuntimeIntegrationAdmin, ...options.authentication } : undefined;
    const config = createRuntimeConfig({
      authenticationOrigin: authentication ? httpOrigin : undefined,
      modelBaseUrl: modelServer.baseUrl,
      pluginRoot,
      serverPort,
    });
    if (authentication) {
      await new AgentLocalAdminAccountStore(
        path.join(workspaceRoot, ".senera", "access", "admin-account.json"),
      ).initialize(authentication);
    }
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
      runResources: [createAgentRequestCancellationResource("approval", approvalRuntime)],
      store: new AgentSessionStore({ repository }),
      piSessions: runtime.piSessionRegistry,
      piSessionMutations: new AgentPiSessionMutationService({
        acquireRuntime: () => ({ runtime, release: () => undefined }),
      }),
      runControl: {
        settlementTimeoutMs: runtime.agentLoopConfig.RunSettlementTimeoutMs,
      },
      loopFactory: (modelProviderId) =>
        new AgentLoop({
          runtime,
          model: new AgentModelEndpointClient(config, modelProviderId),
          preparationFingerprint: RealRuntimePreparationFingerprint,
        }),
    });
    const sandboxRuntimeService = new AgentSandboxRuntimeService({ workspaceRoot, configSnapshot });
    sandboxRuntimeService.markUnavailable(new Error("Runtime integration uses deterministic host capabilities."));
    const server = new AgentWebSocketServer({
      config,
      configService,
      configSnapshot,
      workspaceRoot,
      sessionManager,
      eventWriter: new AgentCallbackRunEventWriter((events) => sessionManager.recordRunEvents(events)),
      userProfileManager: new AgentUserProfileManager(repository),
      approvalRuntime,
      sandboxRuntimeService,
      staticFrontendRoot: options.staticFrontendRoot,
      logger: new AgentLogger(),
    });
    await server.start();
    const websocketUrl = `ws://127.0.0.1:${config.Defaults!.Server!.Port}`;
    const client = authentication
      ? await AgentProtocolIntegrationClient.connectAuthenticated({
          websocketUrl,
          origin: httpOrigin,
          loginName: authentication.loginName,
          password: authentication.password,
        })
      : await AgentProtocolIntegrationClient.connect(websocketUrl);

    return {
      client,
      httpOrigin,
      modelServer,
      workspaceRoot,
      websocketUrl,
      stop: async () => {
        client.close();
        await server.stop();
        await runtime.close();
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
  private readonly stageFailures: PlannerStage[] = [];
  private readonly stagePauses: Array<{
    stage: PlannerStage;
    entered: ReturnType<typeof createDeferred<void>>;
    released: ReturnType<typeof createDeferred<void>>;
  }> = [];
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

  failNext(stage: PlannerStage): void {
    this.stageFailures.push(stage);
  }

  pauseNext(stage: PlannerStage): PlannerStagePause {
    const pause = {
      stage,
      entered: createDeferred<void>(),
      released: createDeferred<void>(),
    };
    this.stagePauses.push(pause);
    return {
      entered: pause.entered.promise,
      release: () => pause.released.resolve(),
    };
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
    if (this.consumeStageFailure(stage)) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: `Deterministic ${stage} failure injected by failNext().` } }));
      return;
    }
    await this.waitForStagePause(stage);
    const output = this.outputFor(stage, payload);
    const content = stage === PlannerStages.GeneratePiFinalAnswer ? String(output) : JSON.stringify(output);
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream; charset=utf-8",
    });
    response.end(
      [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
        `data: ${JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""),
    );
  }

  private outputFor(stage: PlannerStage, payload: unknown): unknown {
    const directResponse = JSON.stringify(payload).includes(RealRuntimeIntegrationValues.DirectRequestInput);
    const outputs: Record<Exclude<PlannerStage, "selectPiAction">, () => unknown> = {
      [PlannerStages.PrepareInteraction]: () => ({
        turnUnderstanding: {
          rawUserTurn: directResponse
            ? RealRuntimeIntegrationValues.DirectRequestInput
            : RealRuntimeIntegrationValues.RequestInput,
          standaloneRequest: directResponse
            ? RealRuntimeIntegrationValues.DirectRequestInput
            : RealRuntimeIntegrationValues.RequestInput,
          contextMode: "None",
          contextBasis: "",
          missingContext: "",
        },
        initialAction: directResponse
          ? {
              kind: "FinalAnswer",
              answerPlan: null,
              question: null,
              preface: null,
              calls: null,
            }
          : {
              kind: "CallTools",
              preface: "我先检查当前注册的命令工具能力。",
              calls: [
                {
                  toolName: RealRuntimeIntegrationValues.ToolName,
                  purpose: "确认是否存在 shell 命令执行能力",
                  required: true,
                  argumentHints: { query: "shell command", includeLoaded: true },
                },
              ],
            },
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
      [PlannerStages.GeneratePiFinalAnswer]: () =>
        directResponse ? RealRuntimeIntegrationValues.DirectFinalAnswer : RealRuntimeIntegrationValues.FinalAnswer,
    };
    if (stage !== PlannerStages.SelectPiAction) return outputs[stage]();

    this.selectPiActionCount += 1;
    return {
      kind: "FinalAnswer",
      answerPlan: ["总结工具检索结论。"],
    };
  }

  private consumeStageFailure(stage: PlannerStage): boolean {
    const index = this.stageFailures.indexOf(stage);
    if (index < 0) return false;
    this.stageFailures.splice(index, 1);
    return true;
  }

  private async waitForStagePause(stage: PlannerStage): Promise<void> {
    const index = this.stagePauses.findIndex((pause) => pause.stage === stage);
    if (index < 0) return;
    const [pause] = this.stagePauses.splice(index, 1);
    pause!.entered.resolve();
    await pause!.released.promise;
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
  authenticationOrigin?: string;
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
        ...(input.authenticationOrigin
          ? {
              AccessControl: {
                Mode: "required" as const,
                AccountFile: ".senera/access/admin-account.json",
                AllowedOrigins: [input.authenticationOrigin],
                Limits: {
                  LoginAttemptsPerMinute: 20,
                  HttpRequestsPerMinute: 100,
                  UpgradeRequestsPerMinute: 100,
                },
              },
            }
          : {}),
      },
      Persistence: { Kind: "memory" },
      PluginRoots: { System: [input.pluginRoot], User: [] },
      AgentLoop: { PiSessions: { RootDir: ".senera/pi-sessions" } },
      ToolLearning: { Enabled: false },
      SandboxRuntime: {
        BaseDir: ".senera/sandbox-runtime",
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
        Model: RealRuntimeIntegrationValues.ModelId,
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

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}
