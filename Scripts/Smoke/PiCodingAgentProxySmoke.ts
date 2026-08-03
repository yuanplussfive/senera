import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
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

const SmokeProviderId = "senera-proxy-smoke";
const SmokeModelId = "proxy-tool-loop";
const SmokeContextId = "smoke-context";

const OpenAiRequestSchema = z.object({
  model: z.string(),
  messages: z.array(
    z
      .object({
        role: z.string(),
      })
      .passthrough(),
  ),
  tools: z
    .array(
      z
        .object({
          function: z
            .object({
              name: z.string(),
            })
            .passthrough(),
        })
        .passthrough(),
    )
    .optional(),
  stream: z.boolean().optional(),
});

type OpenAiRequest = z.infer<typeof OpenAiRequestSchema>;

interface CapturedRequest {
  headers: IncomingMessage["headers"];
  payload: OpenAiRequest;
}

async function main(): Promise<void> {
  const capturedRequests: CapturedRequest[] = [];
  const server = createProxyServer(capturedRequests);
  const agentDir = await mkdtemp(path.join(tmpdir(), "senera-pi-coding-agent-"));
  let disposeSession: (() => void) | undefined;

  try {
    const baseUrl = await listen(server);
    const modelRuntime = await createModelRuntime(baseUrl);
    const model = modelRuntime.getModel(SmokeProviderId, SmokeModelId);
    assert(model, "The smoke-test proxy model was not registered.");

    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: "Use the available add_numbers tool to calculate the requested sum.",
      extensionFactories: [proxyHeaderExtension()],
    });
    await resourceLoader.reload();

    let executionCount = 0;
    const addNumbers = defineTool({
      name: "add_numbers",
      label: "Add numbers",
      description: "Add two numbers and return their sum.",
      parameters: Type.Object({
        left: Type.Number(),
        right: Type.Number(),
      }),
      executionMode: "parallel",
      async execute(_toolCallId, input) {
        executionCount += 1;
        const sum = input.left + input.right;
        return {
          content: [{ type: "text", text: String(sum) }],
          details: { sum },
        };
      },
    });

    const { session } = await createAgentSession({
      cwd: process.cwd(),
      agentDir,
      modelRuntime,
      model,
      thinkingLevel: "off",
      noTools: "builtin",
      customTools: [addNumbers],
      resourceLoader,
      sessionManager: SessionManager.inMemory(process.cwd()),
    });
    disposeSession = () => session.dispose();
    session.setActiveToolsByName([addNumbers.name]);

    await session.prompt("Add 2 and 3.", { source: "extension" });
    await session.waitForIdle();

    assert.equal(executionCount, 1, "The tool should execute exactly once.");
    assert.equal(capturedRequests.length, 2, "The agent should make one tool-call request and one follow-up request.");
    assertProxyRequest(capturedRequests[0], false);
    assertProxyRequest(capturedRequests[1], true);
    assert.match(readFinalAssistantText(session.messages), /sum is 5/i);

    process.stdout.write(
      `${JSON.stringify(
        {
          status: "passed",
          requests: capturedRequests.length,
          toolExecutions: executionCount,
          dynamicHeaders: true,
          toolResultRoundTrip: true,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    disposeSession?.();
    await close(server);
    await rm(agentDir, { recursive: true, force: true });
  }
}

function proxyHeaderExtension(): { name: string; hidden: true; factory: ExtensionFactory } {
  return {
    name: "senera-proxy-headers",
    hidden: true,
    factory: (pi) => {
      pi.on("before_provider_headers", (event) => {
        event.headers["x-senera-model-provider-id"] = SmokeProviderId;
        event.headers["x-senera-pi-context-id"] = SmokeContextId;
      });
    },
  };
}

async function createModelRuntime(baseUrl: string): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    allowModelNetwork: false,
    modelsPath: null,
  });
  runtime.registerProvider(SmokeProviderId, {
    name: "Senera Proxy Smoke",
    baseUrl,
    apiKey: "local-smoke-key",
    api: "openai-completions",
    authHeader: false,
    models: [
      {
        id: SmokeModelId,
        name: "Proxy Tool Loop",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16_384,
        maxTokens: 1_024,
      },
    ],
  });
  return runtime;
}

function createProxyServer(capturedRequests: CapturedRequest[]): Server {
  return createServer((request, response) => {
    void handleProxyRequest(request, response, capturedRequests).catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
}

async function handleProxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  capturedRequests: CapturedRequest[],
): Promise<void> {
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/v1/chat/completions");
  const payload = OpenAiRequestSchema.parse(JSON.parse(await readRequestBody(request)));
  capturedRequests.push({ headers: request.headers, payload });
  const hasToolResult = payload.messages.some((message) => message.role === "tool");
  writeOpenAiStream(response, hasToolResult ? finalTextChunks() : toolCallChunks());
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeOpenAiStream(response: ServerResponse, chunks: readonly object[]): void {
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.end("data: [DONE]\n\n");
}

function toolCallChunks(): object[] {
  return [
    completionChunk({
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: "call_add_numbers",
          type: "function",
          function: { name: "add_numbers", arguments: '{"left":2,"right":3}' },
        },
      ],
    }),
    completionChunk({}, "tool_calls"),
  ];
}

function finalTextChunks(): object[] {
  return [completionChunk({ role: "assistant", content: "The sum is 5." }), completionChunk({}, "stop")];
}

function completionChunk(delta: object, finishReason: string | null = null): object {
  return {
    id: "chatcmpl-senera-smoke",
    object: "chat.completion.chunk",
    created: 0,
    model: SmokeModelId,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function assertProxyRequest(request: CapturedRequest | undefined, expectsToolResult: boolean): void {
  assert(request, "Expected a captured proxy request.");
  assert.equal(request.headers["x-senera-model-provider-id"], SmokeProviderId);
  assert.equal(request.headers["x-senera-pi-context-id"], SmokeContextId);
  assert.equal(request.payload.model, SmokeModelId);
  assert.equal(request.payload.stream, true);
  assert(request.payload.tools?.some((tool) => tool.function.name === "add_numbers"));
  assert.equal(
    request.payload.messages.some((message) => message.role === "tool"),
    expectsToolResult,
  );
}

function readFinalAssistantText(messages: readonly unknown[]): string {
  return (
    messages
      .flatMap((message) => {
        const parsed = z
          .object({
            role: z.literal("assistant"),
            content: z.array(z.unknown()),
          })
          .safeParse(message);
        if (!parsed.success) return [];
        return parsed.data.content.flatMap((part) => {
          const text = z.object({ type: z.literal("text"), text: z.string() }).safeParse(part);
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
  return `http://127.0.0.1:${address.port}/v1`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

await main();
