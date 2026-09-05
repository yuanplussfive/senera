import { afterEach, describe, expect, test, vi } from "vitest";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { AgentImageVisionModelClient } from "../../../Source/AgentSystem/Vision/AgentImageVisionModelClient.js";
import type { AgentImageVisionRequest } from "../../../Source/AgentSystem/Vision/AgentImageVisionTypes.js";

type JsonRecord = Record<string, unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AgentImageVisionModelClient", () => {
  test.each([
    {
      name: "OpenAI Responses",
      endpoint: "Responses" as const,
      response: { output_text: "ok" },
      readImages: (payload: JsonRecord) =>
        arrayProperty(recordAt(arrayProperty(payload, "input"), 1), "content").filter(
          (part) => record(part).type === "input_image",
        ),
    },
    {
      name: "OpenAI Chat Completions",
      endpoint: "ChatCompletions" as const,
      response: { choices: [{ message: { content: "ok" } }] },
      readImages: (payload: JsonRecord) =>
        arrayProperty(recordAt(arrayProperty(payload, "messages"), 1), "content").filter(
          (part) => record(part).type === "image_url",
        ),
    },
    {
      name: "Claude Messages",
      endpoint: "ClaudeMessages" as const,
      response: { content: [{ type: "text", text: "ok" }] },
      readImages: (payload: JsonRecord) =>
        arrayProperty(recordAt(arrayProperty(payload, "messages"), 0), "content").filter(
          (part) => record(part).type === "image",
        ),
    },
    {
      name: "Google Generate Content",
      endpoint: "GoogleGenerateContent" as const,
      response: { candidates: [{ content: { parts: [{ text: "ok" }] } }] },
      readImages: (payload: JsonRecord) =>
        arrayProperty(recordAt(arrayProperty(payload, "contents"), 0), "parts").filter(
          (part) => record(part).inlineData,
        ),
    },
  ])("projects all images in one $name request", async ({ endpoint, response, readImages }) => {
    const fetch = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", fetch);

    await expect(new AgentImageVisionModelClient().complete(createVisionRequest(endpoint))).resolves.toMatchObject({
      text: "ok",
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0] ?? [];
    const images = readImages(JSON.parse(String((init as RequestInit).body)));
    expect(images).toHaveLength(2);
    expect(JSON.stringify(images)).toContain("first-image");
    expect(JSON.stringify(images)).toContain("second-image");
  });
});

function createVisionRequest(endpoint: ReturnType<typeof createModelProvider>["Endpoint"]): AgentImageVisionRequest {
  return {
    provider: createModelProvider({ Endpoint: endpoint }),
    systemPrompt: "Use only visible evidence.",
    prompt: "Compare image 1 and image 2.",
    images: [
      { mime: "image/png", base64: "first-image" },
      { mime: "image/jpeg", base64: "second-image" },
    ],
  };
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function recordAt(values: readonly unknown[], index: number): JsonRecord {
  return record(values[index]);
}

function arrayProperty(value: JsonRecord, key: string): unknown[] {
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : [];
}
