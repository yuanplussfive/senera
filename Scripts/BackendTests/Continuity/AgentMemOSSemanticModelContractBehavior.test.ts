import { Ajv } from "ajv";
import type { AssistantMessage, Context, JsonObject, Tool } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AgentActionPlannerModelTransport } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerModelTransport.js";
import {
  AgentMemOSSemanticModelClient,
  createAgentMemOSExtractionRecordSchema,
} from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticModelClient.js";
import type { AgentMemOSFragmentPromptInput } from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticTypes.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { completedTestPiStream } from "../Support/AgentPiModelTestStream.js";

const createConfiguredProvider = vi.hoisted(() => vi.fn());
vi.mock("../../../Source/AgentSystem/ModelEndpoints/AgentPiConfiguredProvider.js", () => ({
  createAgentPiConfiguredProvider: createConfiguredProvider,
}));

const baseFragment = { topic: "饮食偏好", summary: "用户喜欢牛肉。", type: "preference" };
const current: AgentMemOSFragmentPromptInput = {
  user: "我喜欢牛肉",
  assistant: "记住了。",
  history: [],
  candidates: [],
  memoryIntents: [],
};

beforeEach(() => createConfiguredProvider.mockReset());
afterEach(() => vi.restoreAllMocks());

function nativeClient(responses: readonly JsonObject[], toolName = "MemOSSemanticFragment") {
  const requests: Context[] = [];
  const stream = vi.fn((_model: unknown, context: Context) => {
    const index = requests.push(context) - 1;
    const response = responses[Math.min(index, responses.length - 1)]!;
    return completedTestPiStream(assistantMessage(response, toolName));
  });
  createConfiguredProvider.mockReturnValue({
    model: {
      api: "openai-completions",
      provider: "test-provider",
      id: "test-model",
      baseUrl: "https://model.example/v1",
    },
    provider: { stream },
  });
  const client = new AgentMemOSSemanticModelClient(
    createModelProvider({ ToolPlanningMode: "native", Capabilities: { ToolCalling: true } }),
    "test",
    50,
  );
  return { client, stream, requests };
}

function publishedSchema(requests: Context[]) {
  const tool = publishedTool(requests[0]!);
  return new Ajv({ strict: false }).compile(tool.parameters);
}

function publishedTool(request: Context): Tool {
  return request.messages.find((message) => message.role === "system")!.toolsAdded![0]!;
}

describe("MemOS semantic model source contract", () => {
  test("offers only new when no memory candidates exist, without a candidate field", async () => {
    const f = nativeClient([{ ...baseFragment, action: "new" }]);
    expect(await f.client.extractFragment(current, "extract-empty")).toEqual({ ...baseFragment, action: "new" });
    const validate = publishedSchema(f.requests);
    expect(validate({ ...baseFragment, action: "new" })).toBe(true);
    expect(validate({ ...baseFragment, action: "update:0" })).toBe(false);
    expect(validate({ ...baseFragment, action: "new", candidate: 0 })).toBe(false);
    expect(f.stream).toHaveBeenCalledTimes(1);
  });

  test.each(["update", "supersede"] as const)(
    "binds %s to actual supplied refs with one model choice",
    async (action) => {
      const f = nativeClient([{ ...baseFragment, action: `${action}:17` }]);
      const input = {
        ...current,
        candidates: [
          { ref: 3, summary: "用户喜欢面条。", type: "preference" as const },
          { ref: 17, summary: "用户喜欢牛肉。", type: "preference" as const },
        ],
      };
      expect(await f.client.extractFragment(input, "extract-target")).toEqual({
        ...baseFragment,
        action,
        candidate: 17,
      });
      const validate = publishedSchema(f.requests);
      for (const choice of ["new", "update:3", "supersede:3", "update:17", "supersede:17"])
        expect(validate({ ...baseFragment, action: choice })).toBe(true);
      for (const choice of ["update", "supersede", "update:0", "supersede:99"])
        expect(validate({ ...baseFragment, action: choice })).toBe(false);
      expect(validate({ ...baseFragment, action: `${action}:17`, candidate: 17 })).toBe(false);
    },
  );

  test("lets the durable learning job own invalid-output retries", async () => {
    const f = nativeClient([{ ...baseFragment, action: "new", candidate: 0 }]);
    await expect(f.client.extractFragment(current, "extract-invalid")).rejects.toThrow("invalid arguments");
    expect(f.stream).toHaveBeenCalledOnce();
  });

  test("stops native repair attempts for nonexistent targets and never creates substitute knowledge", async () => {
    const f = nativeClient([{ ...baseFragment, action: "update:99" }]);
    await expect(f.client.extractFragment(current, "extract-invalid")).rejects.toThrow("invalid arguments");
    expect(f.stream).toHaveBeenCalledTimes(1);
  });

  test("advertises native types and no additional fields in the same validating schema", async () => {
    const f = nativeClient([{ ...baseFragment, action: "new" }]);
    await f.client.extractFragment(current, "extract-shape");
    const validate = publishedSchema(f.requests);
    expect(validate({ ...baseFragment, action: "new" })).toBe(true);
    expect(validate({ ...baseFragment, action: "new", type: "profile" })).toBe(false);
    expect(validate({ ...baseFragment, action: "new", type: "entity" })).toBe(true);
    expect(validate({ ...baseFragment, action: "new", topic: "" })).toBe(false);
    expect(validate({ ...baseFragment, action: "new", explanation: "extra" })).toBe(false);
  });

  test("enforces summary limits with the local model tokenizer", async () => {
    const estimator = new AgentModelTokenEstimator({ model: "test-model" });
    let oversized = "summary";
    while (estimator.estimate(oversized).tokenCount <= 50) oversized += " detail";
    const f = nativeClient([{ ...baseFragment, action: "new", summary: oversized }]);
    await expect(f.client.extractFragment(current, "extract-token-limit")).rejects.toThrow("invalid arguments");
    expect(f.stream).toHaveBeenCalledOnce();
  });

  test("enforces the same token contract for period digests", async () => {
    const estimator = new AgentModelTokenEstimator({ model: "test-model" });
    let oversized = "summary";
    while (estimator.estimate(oversized).tokenCount <= 50) oversized += " detail";
    const f = nativeClient([{ summary: oversized }], "MemOSPeriodDigest");
    await expect(
      f.client.summarizePeriod(
        {
          period: "day",
          periodKey: "2026-10-13",
          entries: [{ summary: "记忆", type: "context", occurredAt: "2026-10-13T00:00:00Z" }],
        },
        "digest-token-limit",
      ),
    ).rejects.toThrow("invalid arguments");
    expect(f.stream).toHaveBeenCalledOnce();
  });

  test("supplies the identical output contract to the text planning path", async () => {
    nativeClient([{ ...baseFragment, action: "new" }]);
    const complete = vi.spyOn(AgentActionPlannerModelTransport.prototype, "complete");
    complete.mockResolvedValueOnce(JSON.stringify({ ...baseFragment, action: "update:3" }));
    const client = new AgentMemOSSemanticModelClient(createModelProvider({ ToolPlanningMode: "baml" }), "test", 50);
    const input = { ...current, candidates: [{ ref: 3, summary: "用户喜欢牛肉。", type: "preference" as const }] };
    expect(await client.extractFragment(input, "extract-text")).toEqual({
      ...baseFragment,
      action: "update",
      candidate: 3,
    });
    const prompt = complete.mock.calls[0]![0].systemPrompt;
    expect(prompt).toContain("update:3");
    expect(prompt).toContain("supersede:3");
    expect(prompt).not.toContain("update:4");
    complete.mockResolvedValueOnce(JSON.stringify({ ...baseFragment, action: "update:4" }));
    await expect(client.extractFragment(input, "extract-text-invalid")).rejects.toThrow();
    expect(complete.mock.calls[0]![0].retryMode).toBe("pi");
  });

  test("reads persisted decisions strictly without requesting the model again", () => {
    const schema = createAgentMemOSExtractionRecordSchema("test-model", 50);
    const created = { fragment: { ...baseFragment, action: "new" } };
    const updated = { fragment: { ...baseFragment, action: "update", candidate: 3 }, candidateId: "real-node" };
    expect(schema.parse(created)).toEqual(created);
    expect(schema.parse(updated)).toEqual(updated);
    expect(() => schema.parse({ ...created, candidateId: "real-node" })).toThrow();
    expect(() => schema.parse({ fragment: { ...baseFragment, action: "new", candidate: 3 } })).toThrow();
    expect(() => schema.parse({ fragment: updated.fragment })).toThrow();
    expect(() =>
      schema.parse({ fragment: { ...baseFragment, action: "supersede" }, candidateId: "real-node" }),
    ).toThrow();
  });
});

function assistantMessage(argumentsValue: JsonObject, toolName: string): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "test-provider",
    model: "test-model",
    content: [{ type: "toolCall", id: "memory-call", name: toolName, arguments: argumentsValue }],
    usage: {
      input: 2,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}
