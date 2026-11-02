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
import { AgentMemoryDiaryModel } from "../../../Source/AgentSystem/Continuity/AgentMemoryDiaryModel.js";
import { AgentMemoryDiaryDefaults } from "../../../Source/AgentSystem/Continuity/AgentMemoryDiaryContract.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { completedTestPiStream } from "../Support/AgentPiModelTestStream.js";

const createConfiguredProvider = vi.hoisted(() => vi.fn());
vi.mock("../../../Source/AgentSystem/ModelEndpoints/AgentPiConfiguredProvider.js", () => ({
  createAgentPiConfiguredProvider: createConfiguredProvider,
}));

const baseFragment = { topic: "饮食偏好", summary: "用户喜欢牛肉。", type: "preference", assessments: [] };
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
  test("diaries share the Pi native tool contract and preserve the complete Markdown body", async () => {
    const body = "## 今日进展\n\n" + "具体结果与仍待验证的事项。".repeat(200);
    const f = nativeClient([{ title: "上传链路统一", body }], "MemoryDiary");
    const client = new AgentMemoryDiaryModel(
      createModelProvider({ ToolPlanningMode: "native", Capabilities: { ToolCalling: true } }),
      "test",
    );
    const prompt = client.monthly(
      "2026-09",
      [{ key: "2026-09-01", title: "完成上传", body: "验证了上传流程。" }],
      AgentMemoryDiaryDefaults,
    );
    expect(await client.generate(prompt, "native-diary")).toEqual({ title: "上传链路统一", body });
    const validate = publishedSchema(f.requests);
    expect(validate({ title: "标题", body: "正文" })).toBe(true);
    expect(validate({ title: "标题", summary: "错误字段" })).toBe(false);
    expect(validate({ title: "标题", body: "正文", extra: 1 })).toBe(false);
    expect(validate({ title: "", body: "正文" })).toBe(false);
  });

  test("diaries validate identical title/body output through BAML without truncating Markdown", async () => {
    nativeClient([]);
    const result = { title: "九月进展", body: "## 已完成\n\n保留 Markdown 和事实边界。" };
    const complete = vi
      .spyOn(AgentActionPlannerModelTransport.prototype, "complete")
      .mockResolvedValue(JSON.stringify(result));
    const client = new AgentMemoryDiaryModel(createModelProvider({ ToolPlanningMode: "baml" }), "test");
    const prompt = client.monthly(
      "2026-09",
      [{ key: "2026-09-01", title: "完成", body: "真实结果" }],
      AgentMemoryDiaryDefaults,
    );
    expect(await client.generate(prompt, "baml-diary")).toEqual(result);
    expect(complete.mock.calls[0]![0].retryMode).toBe("pi");
    complete.mockResolvedValueOnce(JSON.stringify({ summary: "retired output" }));
    await expect(client.generate(prompt, "bad-diary")).rejects.toThrow();
  });
  test("requires exactly one reasoned task assessment per delivered memory even on skip", async () => {
    const assessments = [
      {
        candidate: 3,
        usefulness: "helpful",
        reason: "The final answer was tailored to this preference.",
      },
    ];
    const input = {
      ...current,
      sources: [{ ref: 0, kind: "user_message", text: "I still prefer concise replies" }],
      candidates: [{ ref: 3, summary: "Prefers concise replies", type: "preference" as const, delivered: true }],
    };
    const f = nativeClient([{ action: "skip", assessments }]);
    expect(await f.client.extractFragment(input, "assess-delivered")).toEqual({ action: "skip", assessments });
    await expect(
      f.client.extractFragment(
        { ...input, candidates: input.candidates.map((entry) => ({ ...entry, delivered: false })) },
        "not-delivered",
      ),
    ).rejects.toThrow("invalid arguments");
    expect(
      await f.client.extractFragment(
        { ...input, sources: [{ ...input.sources[0]!, text: "A different statement" }] },
        "no-quote-gate",
      ),
    ).toEqual({ action: "skip", assessments });
    for (const invalid of [[], [...assessments, ...assessments], [{ ...assessments[0]!, reason: "" }]]) {
      const broken = nativeClient([{ action: "skip", assessments: invalid }]);
      await expect(broken.client.extractFragment(input, "incomplete-assessment")).rejects.toThrow("invalid arguments");
    }
  });

  test("parses a BAML skip with assessments without requiring a fabricated fragment", async () => {
    const assessments = [{ candidate: 3, usefulness: "unused", reason: "Not used in this task." }];
    vi.spyOn(AgentActionPlannerModelTransport.prototype, "complete").mockResolvedValueOnce(
      JSON.stringify({ action: "skip", assessments }),
    );
    const client = new AgentMemOSSemanticModelClient(createModelProvider({ ToolPlanningMode: "baml" }), "test", 50);
    expect(
      await client.extractFragment(
        { ...current, candidates: [{ ref: 3, summary: "Existing preference", type: "preference", delivered: true }] },
        "baml-skip",
      ),
    ).toEqual({ action: "skip", assessments });
  });

  test("retires quoted evidence and model-assigned truth scores from the learning contract", async () => {
    const f = nativeClient([{ ...baseFragment, action: "new" }]);
    expect((await f.client.extractFragment(current, "no-quote-gate")).action).toBe("new");
    const retired = nativeClient([
      { ...baseFragment, action: "new", evidence: [{ source: 0, quote: current.user, relation: "supports" }] },
    ]);
    // Complete the normal probe before replacing the shared provider mock.
    await expect(retired.client.extractFragment(current, "retired-evidence")).rejects.toThrow("invalid arguments");
    const supported = nativeClient([{ ...baseFragment, action: "new" }]);
    expect(
      (
        await supported.client.extractFragment(
          { ...current, sources: [{ ref: 0, kind: "user_message", text: current.user }] },
          "source-backed",
        )
      ).action,
    ).toBe("new");
  });
  test("permits an explicit no-learning decision without fragment fields", async () => {
    const f = nativeClient([{ action: "skip", assessments: [] }]);
    expect(await f.client.extractFragment(current, "extract-skip")).toEqual({ action: "skip", assessments: [] });
    const validate = publishedSchema(f.requests);
    expect(validate({ action: "skip", assessments: [] })).toBe(true);
    expect(validate({ action: "skip" })).toBe(false);
    expect(validate({ action: "skip", summary: "not allowed" })).toBe(false);
    expect(validate({ ...baseFragment, action: "skip" })).toBe(false);
  });

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
    expect(validate({ ...baseFragment, action: "new", type: "entity" })).toBe(false);
    expect(validate({ ...baseFragment, action: "new", topic: "" })).toBe(false);
    expect(validate({ ...baseFragment, action: "new", explanation: "extra" })).toBe(false);
  });

  test("projects oversized fragment summaries with the local model tokenizer", async () => {
    const estimator = new AgentModelTokenEstimator({ model: "test-model" });
    let oversized = "summary";
    while (estimator.estimate(oversized).tokenCount <= 50) oversized += " detail";
    const f = nativeClient([{ ...baseFragment, action: "new", summary: oversized }]);
    const result = await f.client.extractFragment(current, "extract-token-limit");
    expect(result.action).not.toBe("skip");
    if (result.action === "skip") throw new Error("Expected a fragment decision.");
    expect(estimator.estimate(result.summary).tokenCount).toBeLessThanOrEqual(50);
    expect(result.summary).not.toBe(oversized);
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
    const estimator = new AgentModelTokenEstimator({ model: "test-model" });
    let oversized = "summary";
    while (estimator.estimate(oversized).tokenCount <= 50) oversized += " detail";
    complete.mockResolvedValueOnce(JSON.stringify({ ...baseFragment, action: "update:3", summary: oversized }));
    const projected = await client.extractFragment(input, "extract-text-token-limit");
    expect(projected.action).not.toBe("skip");
    if (projected.action === "skip") throw new Error("Expected a fragment decision.");
    expect(estimator.estimate(projected.summary).tokenCount).toBeLessThanOrEqual(50);
  });

  test("reads persisted decisions strictly without requesting the model again", () => {
    const schema = createAgentMemOSExtractionRecordSchema(50);
    const created = { fragment: { ...baseFragment, action: "new" }, assessmentVersion: 2, assessmentTargets: [] };
    const updated = {
      fragment: { ...baseFragment, action: "update", candidate: 3 },
      candidateId: "real-node",
      assessmentVersion: 2,
      assessmentTargets: ["candidate-0", "candidate-1", "candidate-2", "real-node"],
    };
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
