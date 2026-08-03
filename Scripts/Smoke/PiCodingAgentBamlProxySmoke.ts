import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import { resolveModelProviderConfig } from "../../Source/AgentSystem/AgentDefaults.js";
import { AgentConfigLoader } from "../../Source/AgentSystem/Config/AgentConfigLoader.js";
import { errorMessage } from "../../Source/AgentSystem/Core/AgentErrors.js";
import { projectSeneraModelProviderToPi } from "../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { authorizeAgentPiProxyRequest } from "../../Source/AgentSystem/PiProxy/AgentPiProxyAuthorization.js";
import {
  AgentPiProxyProtocol,
  type AgentPiProxyModelApi,
} from "../../Source/AgentSystem/PiShared/AgentPiProxyProtocol.js";
import { AgentPiProxyHttpApi } from "../../Source/AgentSystem/PiProxy/AgentPiProxyHttpApi.js";
import {
  AgentPiProxyContextHeader,
  AgentPiProxyModelProviderHeader,
  encodePiProxyModelProviderHeaderValue,
} from "../../Source/AgentSystem/PiShared/AgentPiProxyProtocol.js";
import { AgentPiTurnContextRegistry } from "../../Source/AgentSystem/PiShared/AgentPiTurnContext.js";
import { createAgentPiProxyModelAdapter } from "../../Source/AgentSystem/Runtime/AgentPiProxyModelAdapter.js";
import {
  createAgentToolAccessGrant,
  type AgentToolAccessGrant,
} from "../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";

const TestToolName = "AddNumbersTool";
const CodingAgentProxyProviderId = "senera-baml-proxy-smoke";
const DefaultPrompt = `You must call ${TestToolName} to add 17 and 25. After the tool result, answer with the numeric result.`;

const cliOptions = {
  config: { type: "string", default: "senera.config.json" },
  "model-provider-id": { type: "string" },
  prompt: { type: "string", default: DefaultPrompt },
} as const;

interface ProxyRequestInspection {
  authorizationPresent: boolean;
  authorizationMatches: boolean;
  contextHeaderPresent: boolean;
  modelProviderHeader?: string;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({ options: cliOptions, allowPositionals: false });
  const workspaceRoot = process.cwd();
  const configPath = path.resolve(workspaceRoot, values.config);
  const config = AgentConfigLoader.load(configPath);
  const upstream = resolveModelProviderConfig(config, values["model-provider-id"]);
  const projectedProvider = projectSeneraModelProviderToPi(upstream, config);
  const diagnostics: Array<{ name: string; details?: unknown }> = [];
  const turnContexts = new AgentPiTurnContextRegistry();
  const proxyApi = new AgentPiProxyHttpApi({
    configSnapshot: () => config,
    modelFactory: createAgentPiProxyModelAdapter(),
    diagnostics: (event) => {
      diagnostics.push({ name: event.name, details: event.details });
    },
    turnContexts,
  });
  const requestInspections: ProxyRequestInspection[] = [];
  const proxyServer = createAuthenticatedProxyServer(proxyApi, requestInspections);
  const agentDir = await mkdtemp(path.join(tmpdir(), "senera-pi-coding-agent-baml-"));
  let disposeSession: (() => void) | undefined;

  try {
    const baseUrl = await listen(proxyServer);
    const modelRuntime = await createProxyModelRuntime(baseUrl, upstream.Id, projectedProvider.model);
    const model = modelRuntime.getModel(CodingAgentProxyProviderId, upstream.Model);
    assert(model, "The real BAML proxy model was not registered in Pi Coding Agent.");

    const toolAccessGrant = testToolAccessGrant();
    const toolExposure = new AgentToolExposureState(toolAccessGrant);
    let toolExecutions = 0;
    let contextId = "";
    const resourceLoader = new DefaultResourceLoader({
      cwd: workspaceRoot,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: "Follow the user request and use the available tool when it is required.",
      extensionFactories: [proxyHeaderExtension(upstream.Id, () => contextId)],
    });
    await resourceLoader.reload();

    const addNumbers = defineTool({
      name: TestToolName,
      label: "Add numbers",
      description: "Add two numeric values. Use this for deterministic arithmetic addition.",
      parameters: Type.Object({
        left: Type.Number({ description: "First number" }),
        right: Type.Number({ description: "Second number" }),
      }),
      executionMode: "parallel",
      async execute(_toolCallId, input) {
        toolExecutions += 1;
        const sum = input.left + input.right;
        return {
          content: [{ type: "text", text: JSON.stringify({ sum }) }],
          details: { sum },
        };
      },
    });

    const { session } = await createAgentSession({
      cwd: workspaceRoot,
      agentDir,
      modelRuntime,
      model,
      thinkingLevel: "off",
      noTools: "builtin",
      customTools: [addNumbers],
      resourceLoader,
      sessionManager: SessionManager.inMemory(workspaceRoot),
    });
    disposeSession = () => session.dispose();
    session.setActiveToolsByName([TestToolName]);

    const startedAt = performance.now();
    await turnContexts.withContext(
      {
        requestId: "pi-coding-agent-baml-proxy-smoke",
        step: 1,
        toolAccessGrant,
        toolExposure,
      },
      async (registeredContextId) => {
        contextId = registeredContextId;
        await session.prompt(values.prompt, { source: "extension" });
        await session.waitForIdle();
      },
    );
    const finalText = readFinalAssistantText(session.messages);
    const report = {
      status: toolExecutions === 1 && /42/iu.test(finalText) ? "passed" : "failed",
      mode: "real-baml-proxy",
      modelProviderId: upstream.Id,
      model: upstream.Model,
      toolExecutions,
      finalText,
      agentError: session.state.errorMessage,
      durationMs: Math.round(performance.now() - startedAt),
      proxyRequests: requestInspections,
      proxyStages: diagnostics.map((event) => event.name),
      proxyDiagnostics: diagnostics,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    assert.equal(toolExecutions, 1, `${TestToolName} should execute exactly once.`);
    assert.match(finalText, /42/iu, "The final assistant answer should contain the tool result 42.");
  } finally {
    disposeSession?.();
    await close(proxyServer);
    await rm(agentDir, { recursive: true, force: true });
  }
}

function testToolAccessGrant(): AgentToolAccessGrant {
  return createAgentToolAccessGrant({
    authorizedToolNames: [TestToolName],
    exposedToolNames: [TestToolName],
    preferredToolNames: [TestToolName],
  });
}

function proxyHeaderExtension(
  modelProviderId: string,
  contextId: () => string,
): { name: string; hidden: true; factory: ExtensionFactory } {
  return {
    name: "senera-real-proxy-headers",
    hidden: true,
    factory: (pi) => {
      pi.on("before_provider_headers", (event) => {
        event.headers.authorization = `Bearer ${AgentPiProxyProtocol.apiKey}`;
        event.headers[AgentPiProxyModelProviderHeader] = encodePiProxyModelProviderHeaderValue(modelProviderId);
        event.headers[AgentPiProxyContextHeader] = contextId();
      });
    },
  };
}

async function createProxyModelRuntime(
  baseUrl: string,
  upstreamProviderId: string,
  model: {
    id: string;
    name: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
  },
): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({ allowModelNetwork: false, modelsPath: null });
  runtime.registerProvider(CodingAgentProxyProviderId, {
    name: `Senera BAML Proxy (${upstreamProviderId})`,
    baseUrl,
    apiKey: "senera-local-proxy",
    api: AgentPiProxyProtocol.modelApi satisfies AgentPiProxyModelApi,
    authHeader: false,
    models: [
      {
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        input: model.input,
        cost: model.cost,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      },
    ],
  });
  return runtime;
}

function createAuthenticatedProxyServer(proxyApi: AgentPiProxyHttpApi, inspections: ProxyRequestInspection[]): Server {
  return createServer((request, response) => {
    const authorization = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;
    inspections.push({
      authorizationPresent: Boolean(authorization),
      authorizationMatches: authorization === `Bearer ${AgentPiProxyProtocol.apiKey}`,
      contextHeaderPresent: Boolean(request.headers[AgentPiProxyContextHeader]),
      modelProviderHeader: readSingleHeader(request.headers[AgentPiProxyModelProviderHeader]),
    });
    if (!authorizeAgentPiProxyRequest(request)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "pi_proxy_authentication_required" } }));
      return;
    }
    void proxyApi.handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: errorMessage(error) } }));
    });
  });
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readFinalAssistantText(messages: readonly unknown[]): string {
  const AssistantMessageSchema = z.object({
    role: z.literal("assistant"),
    content: z.array(z.unknown()),
  });
  const TextPartSchema = z.object({ type: z.literal("text"), text: z.string() });
  return (
    messages
      .flatMap((message) => {
        const parsed = AssistantMessageSchema.safeParse(message);
        if (!parsed.success) return [];
        return parsed.data.content.flatMap((part) => {
          const text = TextPartSchema.safeParse(part);
          return text.success ? [text.data.text] : [];
        });
      })
      .at(-1) ?? ""
  );
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}${AgentPiProxyProtocol.basePath}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
