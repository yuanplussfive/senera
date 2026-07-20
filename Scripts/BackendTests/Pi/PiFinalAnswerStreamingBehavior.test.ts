import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import type { AgentLanguageModelStream } from "../../../Source/AgentSystem/ModelEndpoints/AgentLanguageModel.js";
import type { AgentPiAssistantCompilerPort } from "../../../Source/AgentSystem/PiProxy/AgentPiAssistantCompiler.js";
import type { AgentPiFinalAnswerGeneratorPort } from "../../../Source/AgentSystem/PiProxy/AgentPiFinalAnswerGenerator.js";
import { AgentPiProxyHttpApi } from "../../../Source/AgentSystem/PiProxy/AgentPiProxyHttpApi.js";
import type { AgentPiFinalAnswerInput } from "../../../Source/AgentSystem/PiProxy/AgentPiAssistantMessageTypes.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("Pi final-answer streaming", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  test("streams generated answer deltas only after the action decision is compiled", async () => {
    const gate = deferred<void>();
    const generator = new FakeFinalAnswerGenerator(async function* () {
      yield "first ";
      await gate.promise;
      yield "second";
    });
    const { url } = await startApi(servers, generator);

    const response = await postChatCompletion(url, true);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const first = decode(await reader!.read());
    expect(first).toContain("first ");
    expect(first).not.toContain("second");

    gate.resolve();
    const remaining = await readRemaining(reader!);
    expect(`${first}${remaining}`).toContain("second");
    expect(`${first}${remaining}`).toContain('"usage":{"prompt_tokens":9,"completion_tokens":3,"total_tokens":12');
    expect(`${first}${remaining}`).toContain("data: [DONE]");
    expect(generator.inputs).toHaveLength(1);
    expect(generator.inputs[0]?.answerPlan).toEqual(["Answer from verified evidence."]);
  });

  test("uses the same final-answer generator for non-streaming OpenAI requests", async () => {
    const generator = new FakeFinalAnswerGenerator(async function* () {
      yield "complete ";
      yield "answer";
    });
    const { url } = await startApi(servers, generator);

    const response = await postChatCompletion(url, false);
    const body = (await response.json()) as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.choices[0]?.message.content).toBe("complete answer");
    expect(body.choices[0]?.finish_reason).toBe("stop");
    expect(body.usage).toMatchObject({ prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 });
  });

  test("aborts final-answer generation when the Pi client disconnects", async () => {
    const started = deferred<void>();
    const cancelled = deferred<void>();
    const generator = new FakeFinalAnswerGenerator(async function* (signal) {
      yield "partial";
      started.resolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      cancelled.resolve();
    });
    const { url } = await startApi(servers, generator);
    const controller = new AbortController();
    const response = await postChatCompletion(url, true, controller.signal);
    await started.promise;

    controller.abort();
    await expect(cancelled.promise).resolves.toBeUndefined();
    await response.body?.cancel().catch(() => undefined);
  });

  test("does not start final-answer generation for a CallTools compilation", async () => {
    const generator = new FakeFinalAnswerGenerator(async function* () {
      yield "unexpected CallTools final answer";
    });
    const { url } = await startApi(servers, generator, async () => ({
      kind: "tool_calls",
      content: "Checking the source.",
      toolCalls: [{ id: "call_lookup", name: "LookupTool", arguments: { key: "status" } }],
    }));

    const response = await postChatCompletion(url, false);
    const body = (await response.json()) as {
      choices: Array<{ message: { tool_calls?: unknown[] }; finish_reason: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.choices[0]?.finish_reason).toBe("tool_calls");
    expect(body.choices[0]?.message.tool_calls).toHaveLength(1);
    expect(generator.inputs).toHaveLength(0);
  });

  test("returns a JSON error before SSE headers when action compilation fails", async () => {
    const generator = new FakeFinalAnswerGenerator(async function* () {
      yield "unexpected failed-decision final answer";
    });
    const { url } = await startApi(servers, generator, async () => {
      throw new Error("Action validation failed after repair.");
    });

    const response = await postChatCompletion(url, true);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toContain("Action validation failed after repair.");
    expect(body).not.toContain("data: [DONE]");
    expect(generator.inputs).toHaveLength(0);
  });

  test("rejects an empty generated answer without completing an SSE stream", async () => {
    const generator = new FakeFinalAnswerGenerator(async function* () {
      yield "   ";
    });
    const { url } = await startApi(servers, generator);

    const response = await postChatCompletion(url, true);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toContain("最终回答生成完成，但没有产生用户可见文本。");
    expect(body).not.toContain("data: [DONE]");
    expect(generator.inputs).toHaveLength(1);
  });
});

class FakeFinalAnswerGenerator implements AgentPiFinalAnswerGeneratorPort {
  readonly inputs: AgentPiFinalAnswerInput[] = [];

  constructor(private readonly chunks: (signal: AbortSignal) => AsyncGenerator<string>) {}

  async stream(input: AgentPiFinalAnswerInput, options: { signal?: AbortSignal }): Promise<AgentLanguageModelStream> {
    this.inputs.push(input);
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", forwardAbort, { once: true });
    const chunks = this.chunks(controller.signal);
    let accumulatedText = "";
    return {
      metadata: {} as AgentLanguageModelStream["metadata"],
      usage: {
        source: "provider_reported",
        inputTokens: 7,
        outputTokens: 3,
        totalTokens: 12,
        cacheReadTokens: 2,
      },
      abort: () => controller.abort(),
      [Symbol.asyncIterator]: async function* () {
        try {
          for await (const textDelta of chunks) {
            accumulatedText += textDelta;
            yield { textDelta, accumulatedText };
          }
        } finally {
          options.signal?.removeEventListener("abort", forwardAbort);
        }
      },
    };
  }
}

async function startApi(
  servers: http.Server[],
  generator: AgentPiFinalAnswerGeneratorPort,
  compile: AgentPiAssistantCompilerPort["compile"] = async () => ({
    kind: "final_answer",
    decisionSource: "model",
    input: createFinalAnswerInput(),
  }),
): Promise<{ url: string }> {
  const compiler: AgentPiAssistantCompilerPort = {
    compile,
  };
  const api = new AgentPiProxyHttpApi({
    configSnapshot: createConfig,
    compilerFactory: () => compiler,
    finalAnswerGeneratorFactory: () => generator,
  });
  const server = http.createServer((request, response) => void api.handle(request, response));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}/v1/chat/completions` };
}

async function postChatCompletion(url: string, stream: boolean, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      messages: [{ role: "user", content: "Answer this." }],
      stream,
    }),
    signal,
  });
}

function createFinalAnswerInput(): AgentPiFinalAnswerInput {
  return {
    openAiRequest: {
      model: "test-model",
      messages: [{ role: "user", content: "Answer this." }],
      toolTranscript: [],
      projection: {
        originalMessageCount: 1,
        projectedMessageCount: 1,
        omittedOlderMessages: 0,
        truncatedTextFields: 0,
        truncatedJsonFields: 0,
        planningInputTokenBudget: 8_192,
      },
    },
    seneraRuntime: {
      modelProviderId: "test-model",
      model: "test-model",
    },
    answerPlan: ["Answer from verified evidence."],
  };
}

function createConfig(): AgentSystemConfig {
  return {
    DefaultModelProviderId: "test-model",
    ModelProviderEndpoints: [
      {
        Id: "test-endpoint",
        BaseUrl: "https://model.invalid/v1",
        ApiKey: "test-key",
      },
    ],
    ModelProviders: [
      {
        Id: "test-model",
        ProviderId: "test-endpoint",
        Endpoint: "ChatCompletions",
        Model: "test-model",
      },
    ],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function decode(result: ReadableStreamReadResult<Uint8Array>): string {
  return result.value ? new TextDecoder().decode(result.value) : "";
}

async function readRemaining(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let output = "";
  for (;;) {
    const result = await reader.read();
    if (result.done) return output;
    output += decode(result);
  }
}

function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
