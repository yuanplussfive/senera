import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { AgentWebToolsConfigurationSchema } from "../../../Source/AgentSystem/Web/AgentWebConfiguration.js";
import {
  extractAgentWebContent,
  selectRelevantBlocks,
} from "../../../Source/AgentSystem/Web/AgentWebContentExtractor.js";
import { fetchWebResource } from "../../../Source/AgentSystem/Web/AgentWebHttpClient.js";
import { DefaultAgentWebRuntime } from "../../../Source/AgentSystem/Web/AgentWebRuntime.js";
import { parseDuckDuckGoResults } from "../../../Source/AgentSystem/Web/AgentWebSearchProviders.js";
import { assertSafeWebUrl } from "../../../Source/AgentSystem/Web/AgentWebUrlPolicy.js";
import { createWebSystemTools } from "../../../Source/AgentSystem/SystemTools/WebSystemTools.js";
import { AgentToolObservationContextCompiler } from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationContextCompiler.js";

const publicAddressResolver = async (): Promise<readonly string[]> => ["93.184.216.34"];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("web host tools", () => {
  test("rejects private hosts and private redirect targets before the request is sent", async () => {
    await expect(
      assertSafeWebUrl("http://127.0.0.1:8080/", {
        maxUrlLength: 4096,
        allowPrivateNetworks: false,
      }),
    ).rejects.toMatchObject({ code: "private_network_blocked" });

    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }),
    );
    await expect(
      fetchWebResource("https://public.example/start", {
        maxRedirects: 5,
        responseMaxBytes: 10_000,
        userAgent: "test",
        maxUrlLength: 4096,
        allowPrivateNetworks: false,
        fetchImpl,
        resolveHostAddresses: publicAddressResolver,
      }),
    ).rejects.toMatchObject({ code: "private_network_blocked" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("permits a proxy Fake-IP mapping for public web hosts without permitting direct reserved addresses", async () => {
    await expect(
      assertSafeWebUrl(
        "https://search.example/query",
        { maxUrlLength: 4_096, allowPrivateNetworks: false, allowSyntheticProxyAddresses: true },
        async () => ["198.18.0.63"],
      ),
    ).resolves.toMatchObject({ hostname: "search.example" });
    await expect(
      assertSafeWebUrl("https://198.18.0.63/query", {
        maxUrlLength: 4_096,
        allowPrivateNetworks: false,
        allowSyntheticProxyAddresses: true,
      }),
    ).rejects.toMatchObject({ code: "private_network_blocked" });
  });

  test("truncates streamed responses at the configured byte budget", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("12345"));
              controller.enqueue(new TextEncoder().encode("67890"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/plain" } },
        ),
    );
    const result = await fetchWebResource("https://public.example/large", {
      maxRedirects: 0,
      responseMaxBytes: 8,
      userAgent: "test",
      maxUrlLength: 4096,
      allowPrivateNetworks: false,
      fetchImpl,
      resolveHostAddresses: publicAddressResolver,
    });

    expect(new TextDecoder().decode(result.body)).toBe("12345678");
    expect(result.transfer).toEqual({ maxBytes: 8, receivedBytes: 8, truncated: true });
  });

  test("enforces a configured request deadline and preserves caller cancellation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );

    await expect(
      fetchWebResource("https://public.example/slow", {
        maxRedirects: 0,
        responseMaxBytes: 10_000,
        timeoutMs: 10,
        userAgent: "test",
        maxUrlLength: 4096,
        allowPrivateNetworks: false,
        fetchImpl,
        resolveHostAddresses: publicAddressResolver,
      }),
    ).rejects.toMatchObject({ code: "timeout", details: { timeoutMs: 10 } });

    const controller = new AbortController();
    const cancellation = new Error("caller cancelled");
    controller.abort(cancellation);
    await expect(
      fetchWebResource(
        "https://public.example/cancelled",
        {
          maxRedirects: 0,
          responseMaxBytes: 10_000,
          timeoutMs: 10_000,
          userAgent: "test",
          maxUrlLength: 4096,
          allowPrivateNetworks: false,
          fetchImpl,
          resolveHostAddresses: publicAddressResolver,
        },
        controller.signal,
      ),
    ).rejects.toBe(cancellation);
  });

  test("extracts readable Markdown, links, title, and prompt-relevant blocks", () => {
    const result = extractAgentWebContent({
      source: `<!doctype html><html><head><title>Example article</title><style>.x{}</style></head><body>
        <nav>Navigation should not be included</nav>
        <article><h1>Example article</h1><p>General introduction.</p><p>Authentication uses a short lived token.</p><a href="/docs">Documentation</a><script>alert('ignored')</script></article>
      </body></html>`,
      contentType: "text/html; charset=utf-8",
      finalUrl: "https://docs.example/article",
      mode: "article",
      extractPrompt: "authentication token",
      maxExtractBlocks: 4,
      maxMarkdownChars: 10_000,
      maxLinks: 8,
    });

    expect(result.title).toContain("Example article");
    expect(result.markdown).toContain("Authentication uses a short lived token.");
    expect(result.markdown).not.toContain("Navigation should not be included");
    expect(result.markdown).not.toContain("alert");
    expect(result.markdownSummary).toContain("Authentication uses a short lived token.");
    expect(result.links).toEqual([{ title: "Documentation", url: "https://docs.example/docs" }]);
  });

  test("uses a configured keyless SearXNG provider, filters domains, cites, and caches", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              { title: "Allowed", url: "https://docs.example/guide#part", content: "Allowed summary" },
              { title: "Blocked", url: "https://blocked.example/page", content: "Should not be returned" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const configuration = AgentWebToolsConfigurationSchema.parse({
      search: { provider: "searxng", endpoint: "https://search.example/search", cacheTtlSeconds: 60 },
      fetch: { allowPrivateNetworks: false },
    });
    const runtime = new DefaultAgentWebRuntime(configuration, {
      fetchImpl,
      resolveHostAddresses: publicAddressResolver,
      now: () => 1_000,
    });

    const first = await runtime.search({
      query: "senera",
      allowedDomains: ["docs.example"],
      blockedDomains: [],
      freshness: "any",
      maxResults: 5,
    });
    const second = await runtime.search({
      query: "senera",
      allowedDomains: ["docs.example"],
      blockedDomains: [],
      freshness: "any",
      maxResults: 5,
    });

    expect(first.results).toHaveLength(1);
    expect(first.results[0]).toMatchObject({ title: "Allowed", url: "https://docs.example/guide" });
    expect(first.results[0]?.citationId).toMatch(/^citation_[a-f0-9]{16}$/u);
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("uses Exa Remote MCP by default and normalizes its structured search results", async () => {
    const mcpPayload = {
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              results: [
                {
                  title: "Senera repository",
                  url: "https://github.com/yuanplussfive/senera#readme",
                  text: "Observable agent runtime.",
                  publishedDate: "2026-08-18T00:00:00.000Z",
                },
              ],
            }),
          },
        ],
      },
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(`event: message\ndata: ${JSON.stringify(mcpPayload)}\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const configuration = AgentWebToolsConfigurationSchema.parse({});
    const runtime = new DefaultAgentWebRuntime(configuration, {
      fetchImpl,
      resolveHostAddresses: publicAddressResolver,
    });

    const output = await runtime.search({
      query: "senera",
      allowedDomains: ["github.com"],
      blockedDomains: [],
      freshness: "month",
      maxResults: 5,
    });

    expect(configuration.search.provider).toBe("exa");
    expect(output.results).toEqual([
      expect.objectContaining({
        title: "Senera repository",
        url: "https://github.com/yuanplussfive/senera",
        summary: "Observable agent runtime.",
        publishTime: "2026-08-18T00:00:00.000Z",
      }),
    ]);
    const requestCall = fetchImpl.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined] | undefined;
    expect(String(requestCall?.[0])).toContain("https://mcp.exa.ai/mcp?tools=web_search_advanced_exa");
    expect(requestCall?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(requestCall?.[1]?.body))).toMatchObject({
      method: "tools/call",
      params: {
        name: "web_search_advanced_exa",
        arguments: { query: "senera", includeDomains: ["github.com"], numResults: 5 },
      },
    });
  });

  test("uses provider-specific credentials without sending them to another provider", async () => {
    const tavilyFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            results: [{ title: "Tavily", url: "https://docs.example/tavily", content: "Tavily summary" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const tavilyRuntime = new DefaultAgentWebRuntime(
      AgentWebToolsConfigurationSchema.parse({ search: { provider: "tavily", tavilyApiKey: "tvly-secret" } }),
      { fetchImpl: tavilyFetch, resolveHostAddresses: publicAddressResolver },
    );
    await tavilyRuntime.search({
      query: "senera",
      allowedDomains: [],
      blockedDomains: [],
      freshness: "any",
      maxResults: 5,
    });
    expect(JSON.parse(String(tavilyFetch.mock.calls[0]?.[1]?.body))).toMatchObject({ api_key: "tvly-secret" });

    const braveFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            web: { results: [{ title: "Brave", url: "https://docs.example/brave", description: "Brave summary" }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const braveRuntime = new DefaultAgentWebRuntime(
      AgentWebToolsConfigurationSchema.parse({
        search: { provider: "brave", braveApiKey: "brave-secret", tavilyApiKey: "tvly-secret" },
      }),
      { fetchImpl: braveFetch, resolveHostAddresses: publicAddressResolver },
    );
    await braveRuntime.search({
      query: "senera",
      allowedDomains: [],
      blockedDomains: [],
      freshness: "any",
      maxResults: 5,
    });
    expect(braveFetch.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-Subscription-Token": "brave-secret" });
    expect(JSON.stringify(braveFetch.mock.calls[0]?.[1]?.headers)).not.toContain("tvly-secret");
  });

  test("reports a recoverable Exa Remote MCP rate limit", async () => {
    const runtime = new DefaultAgentWebRuntime(AgentWebToolsConfigurationSchema.parse({}), {
      fetchImpl: async () => new Response("rate limited", { status: 429 }),
      resolveHostAddresses: publicAddressResolver,
    });
    await expect(
      runtime.search({
        query: "senera",
        allowedDomains: [],
        blockedDomains: [],
        freshness: "any",
        maxResults: 5,
      }),
    ).rejects.toMatchObject({ code: "rate_limited", details: { provider: "exa", status: 429 } });
  });

  test("uses DuckDuckGo HTML search without credentials", async () => {
    const destination = encodeURIComponent("https://docs.example/guide#part");
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          `<div class="result"><h2 class="result__title"><a class="result__a" href="https://html.duckduckgo.com/l/?uddg=${destination}">Docs</a></h2><a class="result__snippet">A useful result.</a></div>`,
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    );
    const configuration = AgentWebToolsConfigurationSchema.parse({
      search: { provider: "duckduckgo" },
    });
    const runtime = new DefaultAgentWebRuntime(configuration, {
      fetchImpl,
      resolveHostAddresses: publicAddressResolver,
    });

    const output = await runtime.search({
      query: "senera",
      allowedDomains: [],
      blockedDomains: [],
      freshness: "any",
      maxResults: 5,
    });

    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toMatchObject({
      title: "Docs",
      url: "https://docs.example/guide",
      summary: "A useful result.",
    });
    const requestCall = fetchImpl.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined] | undefined;
    expect(String(requestCall?.[0])).toContain("html.duckduckgo.com/html/");
    expect(String(requestCall?.[0])).toContain("q=senera");
    const requestInit = requestCall?.[1];
    expect(requestInit?.body).toBeUndefined();
    expect(JSON.stringify(requestInit?.headers)).not.toMatch(/TAVILY|BRAVE|api.key/iu);
  });

  test("projects DuckDuckGo result links, ignores internal links, and preserves lookalike hosts", () => {
    const lookalikeDestination = encodeURIComponent("https://attacker.example/redirect");
    const results = parseDuckDuckGoResults(
      `<div class="result"><h2><a class="result__a" href="/l/?uddg=${encodeURIComponent("https://docs.example/guide#part")}">Docs</a></h2><div class="result__snippet">Summary</div></div>
       <div class="result"><h2><a class="result__a" href="/settings">Internal</a></h2></div>
       <div class="result"><h2><a class="result__a" href="https://evilduckduckgo.com/l/?uddg=${lookalikeDestination}">Lookalike</a></h2></div>`,
      "https://html.duckduckgo.com/html/",
    );

    expect(results).toEqual([
      { title: "Docs", url: "https://docs.example/guide", summary: "Summary" },
      {
        title: "Lookalike",
        url: `https://evilduckduckgo.com/l/?uddg=${lookalikeDestination}`,
        summary: "",
      },
    ]);
  });

  test("evicts the oldest search entry when the configured cache capacity is reached", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ results: [{ title: "Result", url: "https://docs.example/guide" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const configuration = AgentWebToolsConfigurationSchema.parse({
      search: {
        provider: "searxng",
        endpoint: "https://search.example/search",
        cacheTtlSeconds: 60,
        cacheMaxEntries: 1,
      },
    });
    const runtime = new DefaultAgentWebRuntime(configuration, {
      fetchImpl,
      resolveHostAddresses: publicAddressResolver,
      now: () => 1_000,
    });

    const request = (query: string) =>
      runtime.search({
        query,
        allowedDomains: [],
        blockedDomains: [],
        freshness: "any",
        maxResults: 5,
      });
    await request("first");
    await request("second");
    await request("first");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("keeps complete fetched Markdown for Artifact projection while returning a bounded summary", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          "<html><head><title>Docs</title></head><body><main><h1>Docs</h1><p>First paragraph.</p><p>Second paragraph about tokens.</p><a href='https://docs.example/next'>Next</a></main></body></html>",
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    );
    const configuration = AgentWebToolsConfigurationSchema.parse({
      search: { provider: "searxng", endpoint: "https://search.example/search" },
      fetch: { maxExtractBlocks: 1 },
    });
    const runtime = new DefaultAgentWebRuntime(configuration, {
      fetchImpl,
      resolveHostAddresses: publicAddressResolver,
    });
    const result = await runtime.fetch({
      url: "https://docs.example/start",
      contentMode: "article",
      extractPrompt: "tokens",
    });

    expect(result.content).toContain("First paragraph.");
    expect(result.content).toContain("Second paragraph about tokens.");
    expect(result.markdownSummary).toContain("tokens");
    expect(result.links[0]).toEqual({ title: "Next", url: "https://docs.example/next" });
    expect(result.citationId).toMatch(/^citation_[a-f0-9]{16}$/u);
    expect(result.transfer).toMatchObject({ truncated: false, receivedBytes: expect.any(Number) });
  });

  test("returns extracted partial content with a visible truncation marker", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          "<html><head><title>Docs</title></head><body><main><h1>Docs</h1><p>Useful content that continues beyond the selected transfer budget.</p></main></body></html>",
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    );
    const runtime = new DefaultAgentWebRuntime(AgentWebToolsConfigurationSchema.parse({}), {
      fetchImpl,
      resolveHostAddresses: publicAddressResolver,
    });

    const result = await runtime.fetch({
      url: "https://docs.example/truncated",
      contentMode: "article",
      maxBytes: 96,
    });

    expect(result.transfer).toMatchObject({ maxBytes: 96, receivedBytes: 96, truncated: true });
    expect(result.content).toContain("...[Source response truncated after 96 bytes");
    expect(result.markdownSummary).toContain("...[Source response truncated after 96 bytes");
  });

  test("falls back to the first blocks when a local extraction prompt has no lexical hit", () => {
    expect(selectRelevantBlocks("first\n\nsecond\n\nthird", "missing", 2)).toBe("first\n\nsecond");
  });

  test("publishes strict system-tool definitions for both web capabilities", () => {
    expect(createWebSystemTools()).toHaveLength(2);
    expect(createWebSystemTools().map((tool) => tool.name)).toEqual(["WebSearch", "WebFetch"]);
  });

  test("projects configured defaults and bounds into the host-tool input contracts", () => {
    const [search, fetch] = createWebSystemTools({
      search: {
        provider: "searxng",
        endpoint: "https://search.example/search",
        defaultMaxResults: 3,
        maxMaxResults: 4,
        maxOperationTimeoutMs: 600_000,
      },
      fetch: {
        defaultContentMode: "text",
        maxUrlLength: 512,
        responseMaxBytes: 4_096,
        maxOperationTimeoutMs: 600_000,
      },
    });

    expect(search?.input.parse({ query: "senera", timeoutMs: 420_000 })).toMatchObject({
      maxResults: 3,
      timeoutMs: 420_000,
    });
    expect(fetch?.input.parse({ url: "https://docs.example/readme", timeoutMs: 420_000 })).toMatchObject({
      contentMode: "text",
      maxBytes: 4_096,
      timeoutMs: 420_000,
    });
    const fetchSchema = z.toJSONSchema(fetch!.input, { target: "draft-7", io: "input" });
    expect(fetchSchema.properties?.maxBytes).toMatchObject({
      default: 4_096,
      description: expect.stringContaining("truncated and marked"),
    });
    expect(() => search?.input.parse({ query: "senera", maxResults: 5 })).toThrow();
    expect(() => search?.input.parse({ query: "senera", timeoutMs: 600_001 })).toThrow();
    expect(() => fetch?.input.parse({ url: "https://docs.example/readme", timeoutMs: 600_001 })).toThrow();
    expect(() => fetch?.input.parse({ url: `https://docs.example/${"x".repeat(600)}` })).toThrow();
  });

  test("defaults web requests to three minutes while allowing host-bounded overrides", () => {
    const configuration = AgentWebToolsConfigurationSchema.parse({});

    expect(configuration.search).toMatchObject({ requestTimeoutMs: 180_000, maxOperationTimeoutMs: 900_000 });
    expect(configuration.fetch).toMatchObject({ requestTimeoutMs: 180_000, maxOperationTimeoutMs: 900_000 });
    expect(() =>
      AgentWebToolsConfigurationSchema.parse({
        search: { requestTimeoutMs: 180_000, maxOperationTimeoutMs: 179_000 },
      }),
    ).toThrow(/Maximum operation timeout/u);
  });

  test("keeps complete fetched content on the Artifact path instead of the normal observation", () => {
    const fetchTool = createWebSystemTools()[1]!;
    const artifactUri = "senera://artifact/web-fetch";
    const completeContent = "full page content that belongs in the raw Artifact";
    const observation = new AgentToolObservationContextCompiler({ model: "test-model" }).compile(
      {
        toolName: "WebFetch",
        callId: "call-fetch",
        batchId: "batch-fetch",
        status: "success",
        executionStatus: "completed",
        outputAvailability: "complete",
        outcome: undefined,
        process: undefined,
        error: undefined,
        arguments: { url: "https://docs.example/guide" },
        result: {
          title: "Docs",
          finalUrl: "https://docs.example/guide",
          markdownSummary: "Relevant token paragraph.",
          content: completeContent,
          links: [],
          citationId: "citation_docs",
          transfer: { maxBytes: 5_000_000, receivedBytes: 40, truncated: false },
        },
        artifact: {
          artifactUri,
          summary: "Fetched Docs.",
          structuredSummary: {
            headline: "Docs",
            summary: "Relevant token paragraph.",
            retrieval: { artifactUri, refs: ["raw"] },
          },
          evidence: [],
        },
      },
      fetchTool.metadata.observation,
    );

    expect(observation.observation_view.artifact_uri).toBe(artifactUri);
    expect(JSON.stringify(observation)).not.toContain(completeContent);
  });
});
