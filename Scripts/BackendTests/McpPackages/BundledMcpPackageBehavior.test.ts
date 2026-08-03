import { afterEach, describe, expect, test, vi } from "vitest";

interface BundledToolExecution {
  readonly data: Record<string, unknown>;
  readonly summary: string;
}

interface BundledToolModule {
  default(
    input: Record<string, unknown>,
    context: {
      environment: Record<string, string | undefined>;
      signal?: AbortSignal;
    },
  ): Promise<BundledToolExecution>;
}

afterEach(() => vi.unstubAllGlobals());

describe("bundled MCP package behavior", () => {
  test("web research omits nullable provider fields and satisfies its output schema", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        query: "Senera",
        answer: null,
        results: [
          {
            title: "Senera",
            url: "https://example.test/senera",
            content: "A source-backed result.",
            raw_content: null,
            published_date: null,
            favicon: null,
            score: 0.9,
          },
        ],
        images: null,
        response_time: 0.1,
        request_id: "request-1",
        usage: { credits: 1 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const execution = await executeBundledTool(
      "web-research",
      "search",
      { query: "Senera" },
      {
        TAVILY_API_KEY: "test-key",
      },
      controller.signal,
    );

    expect(execution.data).not.toHaveProperty("answer");
    expect(execution.data).toMatchObject({ query: "Senera", images: [], source: "Tavily" });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ signal: controller.signal }));
  });

  test("weather normalizes numeric provider strings and omits unavailable optional fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: "200",
          location: [
            {
              id: "101010100",
              name: "Beijing",
              adm1: "Beijing",
              country: "China",
              lat: "39.90",
              lon: "116.41",
              tz: "Asia/Shanghai",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "200",
          now: {
            obsTime: "2026-07-30T12:00+08:00",
            temp: "31",
            feelsLike: "34",
            text: "Sunny",
            humidity: null,
            windSpeed: "12",
            windDir: "South",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const execution = await executeBundledTool(
      "weather",
      "forecast",
      { location: "Beijing", days: 1 },
      {
        QWEATHER_API_KEY: "test-key",
      },
    );

    expect(execution.data).toMatchObject({
      location: "Beijing",
      resolvedLocation: "Beijing, Beijing, China",
      temperature: 31,
      temperatureUnit: "celsius",
      condition: "Sunny",
      forecast: [],
      source: "QWeather",
    });
    expect(execution.data).not.toHaveProperty("humidity");
  });
});

async function executeBundledTool(
  packageName: string,
  toolName: string,
  input: Record<string, unknown>,
  environment: Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<BundledToolExecution> {
  const module = (await import(
    new URL(`../../../McpServers/${packageName}/mcp/lib/${toolName}.mjs`, import.meta.url).href
  )) as BundledToolModule;
  return module.default(input, { environment, signal });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
