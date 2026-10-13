import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentStructuredModelClient } from "../../../Source/AgentSystem/ModelEndpoints/AgentStructuredModelClient.js";
import { AgentStateCardRuntime } from "../../../Source/AgentSystem/StateCard/AgentStateCardRuntime.js";
import type { ResolvedAgentStateCardConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function stateCardConfig(provider: ReturnType<typeof createModelProvider>): ResolvedAgentStateCardConfig {
  return {
    Enabled: true,
    Client: {
      ModelProvider: provider,
      BaseUrl: provider.BaseUrl,
      ApiKey: provider.ApiKey,
      Model: provider.Model,
      Temperature: 0,
      MaxTokens: -1,
    },
    HistoryBudgetCharacters: 4_000,
    UsesDefaultModel: true,
  };
}

describe("AgentStateCard runtime", () => {
  test("reads persisted history after restart, preserving users and token-bounding assistants", async () => {
    const rewrite = vi
      .spyOn(AgentStructuredModelClient.prototype, "execute")
      .mockResolvedValue({ topicRelation: "continue", standaloneRequest: "杭州的天气" });
    const main = createModelProvider({ Model: "main-model" });
    const provider = createModelProvider({ Model: "rewrite-model" });
    const history = Array.from({ length: 8 }, (_, index) => ({
      request: `user-${index}: ${"完整的用户消息".repeat(30)}`,
      assistant: "这是之前的完整回复。".repeat(500),
      layer: "fine" as const,
      tools: [{ name: "WebSearch", status: "success" as const }],
      artifacts: [],
    }));
    const config = { ...stateCardConfig(provider), HistoryBudgetCharacters: 100_000 };
    const runtime = new AgentStateCardRuntime(main, config, {
      maxRepairAttempts: 0,
      historyTurns: 6,
      assistantPreviewTokens: 256,
      readHistory: () => history,
    });
    const request = { sessionId: "resumed-session", requestId: "new-turn", currentRequest: "杭州呢" };
    const card = await runtime.resolve(request);
    expect(await runtime.resolve(request)).toBe(card);
    expect(rewrite).toHaveBeenCalledOnce();
    const prompt = JSON.parse(rewrite.mock.calls[0]![0].userPrompt);
    expect(prompt.history).toHaveLength(6);
    expect(prompt.history[0].user).toBe(history[2]!.request);
    const estimator = new AgentModelTokenEstimator({ model: provider.Model });
    for (const turn of prompt.history) {
      expect(turn.assistant.endsWith("...")).toBe(true);
      expect(estimator.estimate(turn.assistant).tokenCount).toBeLessThanOrEqual(256);
    }
    expect(card.lastTools).toEqual([{ name: "WebSearch", status: "success" }]);
  });
  test("does not call the rewrite model for the first turn", async () => {
    const rewrite = vi.spyOn(AgentStructuredModelClient.prototype, "execute");
    const provider = createModelProvider();
    const runtime = new AgentStateCardRuntime(provider, stateCardConfig(provider), {
      maxRepairAttempts: 0,
      historyTurns: 6,
      assistantPreviewTokens: 256,
    });

    const card = await runtime.resolve({ sessionId: "session-1", currentRequest: "继续优化一下" });

    expect(rewrite).not.toHaveBeenCalled();
    expect(card.topicRelation).toBe("new_topic");
    expect(card.standaloneRequest).toBe("继续优化一下");
  });

  test("does not retain history or invoke rewriting without a session identity", async () => {
    const rewrite = vi.spyOn(AgentStructuredModelClient.prototype, "execute");
    const provider = createModelProvider();
    const runtime = new AgentStateCardRuntime(provider, stateCardConfig(provider), {
      maxRepairAttempts: 0,
      historyTurns: 6,
      assistantPreviewTokens: 256,
    });

    runtime.recordTurn({ request: "上一段不属于任何会话的请求" });
    const card = await runtime.resolve({ turnIndex: 4, currentRequest: "继续优化" });

    expect(rewrite).not.toHaveBeenCalled();
    expect(card.topicRelation).toBe("new_topic");
  });

  test("uses the rewrite model once a prior turn exists", async () => {
    const rewrite = vi
      .spyOn(AgentStructuredModelClient.prototype, "execute")
      .mockResolvedValue({ topicRelation: "continue", standaloneRequest: "继续优化此前的实现" });
    const provider = createModelProvider();
    const runtime = new AgentStateCardRuntime(provider, stateCardConfig(provider), {
      maxRepairAttempts: 0,
      historyTurns: 6,
      assistantPreviewTokens: 256,
    });

    runtime.recordTurn({ sessionId: "session-1", request: "先实现一个状态卡" });
    const card = await runtime.resolve({ sessionId: "session-1", turnIndex: 1, currentRequest: "继续优化" });

    expect(rewrite).toHaveBeenCalledOnce();
    expect(card.topicRelation).toBe("continue");
    expect(card.standaloneRequest).toBe("继续优化此前的实现");
  });
});
