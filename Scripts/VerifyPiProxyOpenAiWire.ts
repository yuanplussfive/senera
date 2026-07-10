import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import type http from "node:http";
import { projectPiChatCompletionResponse, projectPiChatCompletionStreamEvents } from "../Source/AgentSystem/PiProxy/AgentPiOpenAiResponseProjector.js";
import {
  AgentPiProxyHttpApi,
  buildPiProxyBaseUrl,
} from "../Source/AgentSystem/PiProxy/AgentPiProxyHttpApi.js";
import {
  AgentPiProxyContextHeader,
  withPiProxyRuntimeContext,
} from "../Source/AgentSystem/PiProxy/AgentPiProxyRuntimeContext.js";
import { AgentWebSocketHttpRouter } from "../Source/AgentSystem/WebSocket/AgentWebSocketHttpRouter.js";
import { AgentUploadHttpApi } from "../Source/AgentSystem/Uploads/AgentUploadHttpApi.js";
import { AgentUploadStore } from "../Source/AgentSystem/Uploads/AgentUploadStore.js";
import type {
  AgentPiAssistantCompileRequest,
  AgentPiAssistantCompilerPort,
} from "../Source/AgentSystem/PiProxy/AgentPiAssistantCompiler.js";
import { projectSeneraModelProviderToPi } from "../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import type {
  AgentSystemConfig,
  ResolvedAgentModelProviderConfig,
} from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const config: AgentSystemConfig = {
  Server: {
    Host: "127.0.0.1",
    Port: 8787,
  },
  DefaultModelProviderId: "main",
  ModelProviderEndpoints: [{
    Id: "main",
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test-key",
  }],
  ModelProviders: [{
    Id: "test-model",
    ProviderId: "main",
    Endpoint: "ChatCompletions",
    Model: "test-model",
  }],
};

const provider: ResolvedAgentModelProviderConfig = {
  Id: "test-model",
  ProviderId: "main",
  Kind: "OpenAICompatible",
  Endpoint: "ChatCompletions",
  BaseUrl: "https://example.invalid/v1",
  ApiKey: "test-key",
  ApiVersion: "",
  Model: "test-model",
  Temperature: 0,
  MaxOutputTokens: -1,
  Stream: true,
  TimeoutMs: 20_000,
  FirstTokenTimeoutMs: 20_000,
  MaxRequestMs: 20_000,
  MaxNetworkRetries: 1,
  Headers: {},
  Capabilities: {
    ToolCalling: false,
  },
};

const projected = projectSeneraModelProviderToPi(provider, config);
assert.equal(projected.model.provider, "senera-pi-proxy");
assert.equal(projected.model.api, "openai-completions");
assert.equal(projected.model.baseUrl, buildPiProxyBaseUrl(config));
assert.equal(projected.upstream.baseUrl, provider.BaseUrl);
assert.equal(buildPiProxyBaseUrl({
  ...config,
  Server: {
    Host: "0.0.0.0",
    Port: 8787,
  },
}), "http://127.0.0.1:8787/v1");

const toolMessage = {
  kind: "tool_calls" as const,
  content: "我先调用回声工具确认输入。",
  toolCalls: [{
    id: "call_verify",
    name: "SeneraEchoTool",
    arguments: {
      text: "hello",
    },
  }],
};

const completion = projectPiChatCompletionResponse("test-model", toolMessage);
assert.equal(completion.choices[0]?.finish_reason, "tool_calls");
assert.equal(completion.choices[0]?.message.content, "我先调用回声工具确认输入。");
assert.equal(completion.choices[0]?.message.tool_calls?.[0]?.id, "call_verify");
assert.equal(completion.choices[0]?.message.tool_calls?.[0]?.function.name, "SeneraEchoTool");
assert.equal(completion.choices[0]?.message.tool_calls?.[0]?.function.arguments, "{\"text\":\"hello\"}");

const streamEvents = projectPiChatCompletionStreamEvents("test-model", toolMessage);
const serialized = streamEvents.map((event) => JSON.stringify(event)).join("\n");
assert.match(serialized, /"finish_reason":"tool_calls"/);
assert.match(serialized, /我先调用回声工具确认输入/);
assert.match(serialized, /"tool_calls"/);
assert.match(serialized, /"SeneraEchoTool"/);
assert.match(serialized, /\\"text\\":\\"hello\\"/);

const finalCompletion = projectPiChatCompletionResponse("test-model", {
  kind: "final_text",
  content: "完成。",
  toolCalls: [],
});
assert.equal(finalCompletion.choices[0]?.finish_reason, "stop");
assert.equal(finalCompletion.choices[0]?.message.content, "完成。");

async function verifyPiProxyRuntimeContextForwarding(): Promise<void> {
  const rootCommand = {
    authority: "senera_runtime_root",
    objective: "verify context forwarding",
  };
  const activeSkills = [{
    name: "VerifySkill",
    title: "Verify Skill",
  }];
  const events: unknown[] = [];
  const compiler = new SpyCompiler();
  const api = new AgentPiProxyHttpApi({
    configSnapshot: () => config,
    compilerFactory: () => compiler,
    onEvent: (event) => {
      events.push(event);
    },
  });
  const router = new AgentWebSocketHttpRouter({
    uploadApi: new AgentUploadHttpApi({
      storeFactory: () => new AgentUploadStore({
        workspaceRoot: process.cwd(),
        rootDir: ".senera/uploads",
        maxFileBytes: 1_024,
      }),
    }),
    piProxyApi: api,
  });

  const response = await withPiProxyRuntimeContext(
    {
      requestId: "verify-pi-proxy-context",
      step: 3,
      rootCommand,
      activeSkills,
    },
    async (contextId) => {
      const request = new MockHttpRequest({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          [AgentPiProxyContextHeader]: contextId,
        },
        body: JSON.stringify({
          model: "test-model",
          messages: [{
            role: "developer",
            content: "runtime rule",
          }, {
            role: "user",
            content: "hello",
          }],
          tools: [{
            type: "function",
            function: {
              name: "SeneraEchoTool",
              description: "Echo input.",
              parameters: {
                type: "object",
                properties: {},
              },
            },
          }],
        }),
      });
      const output = new MockHttpResponse();
      const incoming = request as unknown as http.IncomingMessage;
      assert.equal(api.canHandle(incoming), true);
      await router.handle(incoming, output as unknown as http.ServerResponse);
      return output;
    },
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(compiler.lastRequest?.request.messages.map((message) => message.role), [
    "developer",
    "user",
  ]);
  assert.equal(compiler.lastRequest?.runtime?.rootCommand, rootCommand);
  assert.deepEqual(compiler.lastRequest?.runtime?.activeSkills, activeSkills);
  assert.equal(events.some((event) =>
    readRecord(event).kind === "pi.trace"
    && readRecord(readRecord(event).context).requestId === "verify-pi-proxy-context"
  ), true);
  assert.equal(events.some((event) =>
    readRecord(event).kind === "assistant.message.created"
    && readRecord(readRecord(event).data).kind === "tool_preface"
    && readRecord(readRecord(event).data).content === "I will call a tool first."
  ), true);
  assert.equal(events.some((event) =>
    readRecord(event).kind === "tool.calls.planned"
    && readRecord(readRecord(event).data).executionMode === "parallel"
  ), true);
  const prefaceBatchId = readRecord(readRecord(
    events.find((event) => readRecord(event).kind === "assistant.message.created"),
  ).data).batchId;
  const plannedBatchId = readRecord(readRecord(
    events.find((event) => readRecord(event).kind === "tool.calls.planned"),
  ).data).batchId;
  assert.equal(prefaceBatchId, plannedBatchId);
  assert.match(String(plannedBatchId), /^toolbatch_/);
  assert.match(response.bodyText(), /"content":"I will call a tool first."/);
  assert.match(response.bodyText(), /"tool_calls"/);
}

class SpyCompiler implements AgentPiAssistantCompilerPort {
  lastRequest?: AgentPiAssistantCompileRequest;

  async compile(input: AgentPiAssistantCompileRequest) {
    this.lastRequest = input;
    return {
      kind: "tool_calls" as const,
      content: "I will call a tool first.",
      toolCalls: [{
        id: "call_context",
        name: "SeneraEchoTool",
        arguments: {},
      }],
    };
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

class MockHttpRequest extends Readable {
  readonly method: string;
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
  private body: Buffer;
  private sent = false;

  constructor(options: {
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }) {
    super();
    this.method = options.method;
    this.url = options.url;
    this.headers = options.headers;
    this.body = Buffer.from(options.body, "utf8");
  }

  _read(): void {
    if (this.sent) {
      this.push(null);
      return;
    }
    this.sent = true;
    this.push(this.body);
    this.push(null);
  }
}

class MockHttpResponse extends Writable {
  statusCode = 0;
  headers: http.OutgoingHttpHeaders = {};
  private readonly chunks: Buffer[] = [];

  writeHead(statusCode: number, headers?: http.OutgoingHttpHeaders): this {
    this.statusCode = statusCode;
    this.headers = headers ?? {};
    return this;
  }

  bodyText(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }

  _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }
}

verifyPiProxyRuntimeContextForwarding().then(
  () => {
    console.log("Pi proxy OpenAI wire projection verified.");
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
