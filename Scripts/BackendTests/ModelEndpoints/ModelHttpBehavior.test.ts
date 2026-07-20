import { afterEach, describe, expect, test, vi } from "vitest";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { createModelProviderMetadata } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelMetadata.js";
import { createModelRequestLifetime } from "../../../Source/AgentSystem/ModelEndpoints/ModelHttpAbort.js";
import { ModelHttpClient } from "../../../Source/AgentSystem/ModelEndpoints/ModelHttpClient.js";
import { ModelProviderHttpError } from "../../../Source/AgentSystem/ModelEndpoints/ModelHttpErrors.js";
import { createModelHttpUrl, rawPathSegment } from "../../../Source/AgentSystem/ModelEndpoints/ModelHttpUrl.js";
import { collectModelStream, createSseResponse } from "./ModelEndpointTestFixtures.js";
import { createProviderReportedUsage } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("model HTTP transport", () => {
  test("encodes endpoint paths safely and preserves explicit provider method paths", () => {
    const config = createModelProvider({ BaseUrl: "https://gateway.example/v1/models" });
    expect(createModelHttpUrl(config, ["chat", "completions"]).toString()).toBe(
      "https://gateway.example/v1/models/chat/completions",
    );
    expect(createModelHttpUrl(config, ["models", rawPathSegment("gemini-2.5:streamGenerateContent")]).pathname).toBe(
      "/v1/models/models/gemini-2.5:streamGenerateContent",
    );
  });

  test("retries temporary provider failures and sends only supplied request data", async () => {
    const config = createModelProvider({ BaseUrl: "https://gateway.example/v1", MaxNetworkRetries: 1 });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503, statusText: "Unavailable" }))
      .mockResolvedValueOnce(Response.json({ answer: "ready" }));
    vi.stubGlobal("fetch", fetch);
    const client = new ModelHttpClient(config, createModelProviderMetadata(config));

    await expect(
      client.postJson(["chat", "completions"], { message: "hello" }, { Authorization: "Bearer test-secret" }),
    ).resolves.toEqual({ answer: "ready" });

    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[1] ?? [];
    expect(String(url)).toBe("https://gateway.example/v1/chat/completions");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ message: "hello" }) });
    expect(new Headers((init as RequestInit).headers).get("authorization")).toBe("Bearer test-secret");
  });

  test("normalizes non-retryable provider errors while preserving the HTTP cause", async () => {
    const config = createModelProvider({ MaxNetworkRetries: 2 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid credential", { status: 401, statusText: "Denied" })),
    );
    const client = new ModelHttpClient(config, createModelProviderMetadata(config));

    await expect(client.postJson(["responses"], {}, {})).rejects.toEqual(
      expect.objectContaining({
        cause: expect.objectContaining({ status: 401, detail: "invalid credential" }),
      }),
    );
    expect(fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  test("decodes UTF-8 SSE split across byte chunks and ignores completion sentinels", async () => {
    const config = createModelProvider({ FirstTokenTimeoutMs: -1 });
    const events = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n',
      "data: [DONE]\n\n",
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createSseResponse(events, [35, 71])));
    const client = new ModelHttpClient(config, createModelProviderMetadata(config));

    const stream = await client.postSseStream(["chat", "completions"], { stream: true }, {}, (event) => ({
      textDelta: (event.choices as Array<{ delta?: { content?: string } }> | undefined)?.[0]?.delta?.content ?? "",
      usage: event.usage
        ? createProviderReportedUsage({
            inputTokens: (event.usage as { prompt_tokens?: number }).prompt_tokens,
            outputTokens: (event.usage as { completion_tokens?: number }).completion_tokens,
            totalTokens: (event.usage as { total_tokens?: number }).total_tokens,
          })
        : undefined,
    }));

    await expect(collectModelStream(stream)).resolves.toEqual([
      { textDelta: "你", accumulatedText: "你" },
      { textDelta: "好", accumulatedText: "你好" },
    ]);
    expect(stream.usage).toEqual({
      source: "provider_reported",
      inputTokens: 8,
      outputTokens: 2,
      totalTokens: 10,
    });
  });

  test("surfaces malformed stream data and honors pre-aborted request lifetimes", async () => {
    const config = createModelProvider({ FirstTokenTimeoutMs: -1 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createSseResponse(["data: not-json\n\n"])));
    const client = new ModelHttpClient(config, createModelProviderMetadata(config));
    const stream = await client.postSseStream(["responses"], {}, {}, () => ({}));

    await expect(collectModelStream(stream)).rejects.toThrow();

    const parent = new AbortController();
    const reason = new Error("caller cancelled");
    parent.abort(reason);
    const lifetime = createModelRequestLifetime(config, parent.signal);
    expect(lifetime.signal.aborted).toBe(true);
    expect(lifetime.signal.reason).toBe(reason);
    lifetime.dispose();
  });

  test("removes parent abort listeners when a request lifetime is disposed", () => {
    const config = createModelProvider({ MaxRequestMs: 10_000 });
    const parent = new AbortController();
    const lifetime = createModelRequestLifetime(config, parent.signal);

    lifetime.dispose();
    parent.abort(new Error("caller cancelled after completion"));

    expect(lifetime.signal.aborted).toBe(false);
  });

  test("rejects oversized JSON and SSE responses using provider budgets", async () => {
    const jsonConfig = createModelProvider({ MaxNetworkRetries: 0, MaxResponseBytes: 8 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ answer: "too large" })));
    const jsonClient = new ModelHttpClient(jsonConfig, createModelProviderMetadata(jsonConfig));

    await expect(jsonClient.postJson(["responses"], {}, {})).rejects.toMatchObject({
      cause: expect.objectContaining({ name: "ModelResponseLimitError", kind: "response", limit: 8 }),
    });

    const sseConfig = createModelProvider({
      MaxNetworkRetries: 0,
      FirstTokenTimeoutMs: -1,
      MaxResponseBytes: 1_024,
      MaxSseEventBytes: 8,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createSseResponse(['data: {"value":"too large"}\n\n'])));
    const sseClient = new ModelHttpClient(sseConfig, createModelProviderMetadata(sseConfig));
    const stream = await sseClient.postSseStream(["responses"], {}, {}, () => ({}));

    await expect(collectModelStream(stream)).rejects.toMatchObject({
      cause: expect.objectContaining({ name: "ModelResponseLimitError", kind: "SSE event", limit: 8 }),
    });
  });
});

test("provider HTTP errors retain structured status metadata", () => {
  const error = new ModelProviderHttpError(429, "Too Many Requests", "retry later");
  expect(error).toMatchObject({ status: 429, detail: "retry later" });
});
