import type http from "node:http";
import { Readable, Writable } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentPiProxyHttpApi } from "../../../Source/AgentSystem/PiProxy/AgentPiProxyHttpApi.js";
import {
  AgentPiProxyContextHeader,
  AgentPiProxyModelProviderHeader,
} from "../../../Source/AgentSystem/PiShared/AgentPiProxyProtocol.js";
import { AgentPiTurnContextRegistry } from "../../../Source/AgentSystem/PiShared/AgentPiTurnContext.js";
import { emptyAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";

const config: AgentSystemConfig = {
  Server: { Host: "127.0.0.1", Port: 8787 },
  DefaultModelProviderId: "proxy-test-model",
  ModelProviderEndpoints: [
    {
      Id: "proxy-test-endpoint",
      BaseUrl: "https://example.invalid/v1",
      ApiKey: "test-key",
    },
  ],
  ModelProviders: [
    {
      Id: "proxy-test-model",
      ProviderId: "proxy-test-endpoint",
      Endpoint: "ChatCompletions",
      Model: "proxy-test-model",
    },
  ],
};

describe("Pi proxy HTTP context boundary", () => {
  test.each([
    ["missing", undefined],
    ["stale", "stale"],
  ])("rejects a %s turn context before invoking the compiler", async (_label, contextState) => {
    const turnContexts = new AgentPiTurnContextRegistry();
    const compile = vi.fn(async () => ({ kind: "final_text" as const, content: "unexpected", toolCalls: [] }));
    const api = new AgentPiProxyHttpApi({
      configSnapshot: () => config,
      modelFactory: { createCompiler: () => ({ compile }) },
      turnContexts,
    });
    const contextId = contextState ? turnContexts.register(createContext()) : undefined;
    if (contextId) turnContexts.release(contextId);

    const response = await postCompletion(api, contextId);

    expect(response.statusCode).toBe(400);
    expect(response.bodyJson()).toMatchObject({ error: { code: "invalid_pi_context" } });
    expect(compile).not.toHaveBeenCalled();
  });

  test("keeps provider failures authoritative when the diagnostic sink throws", async () => {
    const turnContexts = new AgentPiTurnContextRegistry();
    const providerFailure = new Error("private provider failure");
    const api = new AgentPiProxyHttpApi({
      configSnapshot: () => config,
      modelFactory: {
        createCompiler: () => ({
          compile: async () => {
            throw providerFailure;
          },
        }),
      },
      diagnostics: () => {
        throw new Error("diagnostic sink failure");
      },
      turnContexts,
    });

    const response = await turnContexts.withContext(createContext(), (contextId) => postCompletion(api, contextId));

    expect(response.statusCode).toBe(500);
    expect(response.bodyJson()).toMatchObject({ error: { code: "senera_pi_proxy_error" } });
    expect(response.bodyText()).not.toContain(providerFailure.message);
    expect(turnContexts.size).toBe(0);
  });
});

function createContext() {
  const toolAccessGrant = emptyAgentToolAccessGrant();
  return {
    requestId: "proxy-test-request",
    toolAccessGrant,
    toolExposure: new AgentToolExposureState(toolAccessGrant),
  };
}

async function postCompletion(api: AgentPiProxyHttpApi, contextId?: string): Promise<MockHttpResponse> {
  const request = new MockHttpRequest({
    [AgentPiProxyModelProviderHeader]: "proxy-test-model",
    ...(contextId ? { [AgentPiProxyContextHeader]: contextId } : {}),
  });
  const response = new MockHttpResponse();
  await api.handle(request as unknown as http.IncomingMessage, response as unknown as http.ServerResponse);
  return response;
}

class MockHttpRequest extends Readable {
  readonly method = "POST";
  readonly url = "/v1/chat/completions";
  readonly socket = { localAddress: "127.0.0.1", remoteAddress: "127.0.0.1" };
  private sent = false;

  constructor(readonly headers: http.IncomingHttpHeaders) {
    super();
  }

  _read(): void {
    if (this.sent) return;
    this.sent = true;
    this.push(
      JSON.stringify({
        model: "proxy-test-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    );
    this.push(null);
  }
}

class MockHttpResponse extends Writable {
  statusCode = 0;
  headersSent = false;
  private readonly chunks: Buffer[] = [];

  writeHead(statusCode: number): this {
    this.statusCode = statusCode;
    this.headersSent = true;
    return this;
  }

  bodyText(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }

  bodyJson(): unknown {
    return JSON.parse(this.bodyText()) as unknown;
  }

  _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }
}
