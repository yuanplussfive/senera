import { describe, expect, test, vi } from "vitest";
import { AgentConversationBoundaryModelClient } from "../../../Source/AgentSystem/TemporalMemory/AgentConversationBoundaryModelClient.js";
import type { AgentConversationBoundaryPromptInput } from "../../../Source/AgentSystem/TemporalMemory/AgentTemporalMemoryTypes.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

describe("conversation boundary model client", () => {
  test("uses only native structured output for a native model", async () => {
    const native = vi.fn(async () => ({ relation: "continue", confidence: 0.94, focus: "项目迁移进度" }));
    const baml = vi.fn(async () => ({ relation: "boundary", confidence: 0.8, focus: "天气查询" }));
    const client = new AgentConversationBoundaryModelClient(
      createModelProvider({
        Endpoint: "Responses",
        ToolPlanningMode: "native",
        Capabilities: { ToolCalling: true },
      }),
      "temporal_scope_test",
      { native: { classify: native }, baml: { classify: baml } },
    );

    await expect(client.classify(promptInput())).resolves.toEqual({
      relation: "continue",
      confidence: 0.94,
      focus: "项目迁移进度",
    });
    expect(native).toHaveBeenCalledOnce();
    expect(baml).not.toHaveBeenCalled();
  });

  test("uses only BAML structured output for a BAML model", async () => {
    const native = vi.fn(async () => ({ relation: "continue", confidence: 0.94, focus: "项目迁移进度" }));
    const baml = vi.fn(async () => ({ relation: "boundary", confidence: 0.88, focus: "天气查询" }));
    const client = new AgentConversationBoundaryModelClient(
      createModelProvider({ ToolPlanningMode: "baml", Capabilities: { ToolCalling: false } }),
      "temporal_scope_test",
      { native: { classify: native }, baml: { classify: baml } },
    );

    await expect(client.classify(promptInput())).resolves.toEqual({
      relation: "boundary",
      confidence: 0.88,
      focus: "天气查询",
    });
    expect(baml).toHaveBeenCalledOnce();
    expect(native).not.toHaveBeenCalled();
  });
});

function promptInput(): AgentConversationBoundaryPromptInput {
  return {
    timeZone: "Asia/Shanghai",
    elapsedSeconds: 20,
    sameLocalDate: true,
    anchors: ["完成项目迁移"],
    openSegment: {
      digestUri: "senera://memory-digest/open",
      periodStart: "2026-08-31T01:00:00Z",
      periodEnd: "2026-08-31T01:01:00Z",
      focus: null,
      turns: [
        {
          episodeUri: "senera://memory-episode/one",
          startedAt: "2026-08-31T01:00:00Z",
          completedAt: "2026-08-31T01:01:00Z",
          user: "迁移现在怎么样了？",
          assistant: "数据库部分已经完成。",
          tools: [],
        },
      ],
    },
    candidate: {
      episodeUri: "senera://memory-episode/two",
      startedAt: "2026-08-31T01:01:20Z",
      completedAt: "2026-08-31T01:01:30Z",
      user: "那前端呢？",
      assistant: "正在核对前端。",
      tools: [],
    },
  };
}
