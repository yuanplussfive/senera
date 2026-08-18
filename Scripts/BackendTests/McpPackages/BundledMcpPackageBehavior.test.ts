import { afterEach, describe, expect, test, vi } from "vitest";

interface BundledToolExecution {
  readonly data: Record<string, unknown>;
  readonly artifactPayload?: {
    readonly rawResponse?: unknown;
    readonly assets?: readonly {
      readonly id: string;
      readonly fileName: string;
      readonly mediaType: string;
      readonly dataBase64: string;
    }[];
  };
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

  test("imagen uses the generations route and keeps image bytes in the artifact payload", async () => {
    const imageBase64 = Buffer.from("fake-png").toString("base64");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ b64_json: imageBase64, revised_prompt: "A small blue bird." }] }));
    vi.stubGlobal("fetch", fetchMock);

    const execution = await executeBundledTool(
      "imagen",
      "generate",
      { prompt: "A small blue bird." },
      {
        IMAGEN_API_KEY: "test-key",
        IMAGEN_API_URL: "https://example.test/v1",
        IMAGEN_REQUEST_MODE: "images",
      },
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.test/v1/images/generations");
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "gpt-image-2",
      prompt: "A small blue bird.",
      size: "1536x1024",
    });
    expect(execution.data).toMatchObject({ mode: "images", model: "gpt-image-2", size: "1536x1024" });
    expect(execution.data.markdown).toContain("senera://artifact-asset/imagen-1");
    expect(execution.artifactPayload?.rawResponse).toMatchObject({ data: [{ b64_json: imageBase64 }] });
    expect(execution.artifactPayload?.assets?.[0]).toMatchObject({
      id: "imagen-1",
      mediaType: "image/png",
      dataBase64: imageBase64,
    });
  });

  test("imagen uses chat completions and preserves provider markdown links", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "chatcmpl-test",
        choices: [{ message: { content: "Here is the image:\n\n![A sunset](https://cdn.example.test/sunset.png)" } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const execution = await executeBundledTool(
      "imagen",
      "generate",
      { prompt: "A sunset", mode: "chat", size: "1024x1024" },
      {
        IMAGEN_API_KEY: "test-key",
        IMAGEN_API_URL: "https://example.test/v1",
        IMAGEN_REQUEST_MODE: "images",
      },
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.test/v1/chat/completions");
    expect(body).toMatchObject({ model: "gpt-image-2", stream: false });
    expect(body.messages[0].content).toContain("size: 1024x1024");
    expect(execution.data).toMatchObject({ mode: "chat", text: expect.stringContaining("Here is the image") });
    expect(execution.data.markdown).toContain("https://cdn.example.test/sunset.png");
    expect(execution.artifactPayload?.assets).toEqual([]);
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
