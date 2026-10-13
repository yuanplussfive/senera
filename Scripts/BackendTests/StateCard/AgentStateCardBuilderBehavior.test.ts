import { describe, expect, test } from "vitest";
import {
  AgentStateCardHistoryLayers,
  AgentStateCardSchemaVersion,
  buildAgentStateCard,
} from "../../../Source/AgentSystem/StateCard/index.js";
import type {
  AgentStateCardBuildInput,
  AgentStateCardHistoryTurn,
} from "../../../Source/AgentSystem/StateCard/index.js";

const FixedNow = new Date("2026-10-04T01:12:00Z");

function historyTurn(partial: Partial<AgentStateCardHistoryTurn> & { request: string }): AgentStateCardHistoryTurn {
  return {
    request: partial.request,
    layer: partial.layer ?? AgentStateCardHistoryLayers.Fine,
    tools: partial.tools ?? [],
    artifacts: partial.artifacts ?? [],
  };
}

describe("AgentStateCard builder", () => {
  test("does not infer semantics from keywords, short requests or history", () => {
    for (const request of ["继续", "上海", "你好", "画图", "why", "continue"]) {
      const card = buildAgentStateCard({
        currentRequest: request,
        history: [historyTurn({ request: "previous request" })],
        now: FixedNow,
      });
      expect(card).not.toHaveProperty("intentClass");
      expect(card).not.toHaveProperty("contextMode");
      expect(card.topicRelation).toBe("new_topic");
      expect(card.standaloneRequest).toBe(request);
    }
  });

  test("starts a continuation-shaped request as a new topic without prior context", () => {
    const card = buildAgentStateCard({
      currentRequest: "继续优化一下",
      history: [],
      now: FixedNow,
    });

    expect(card.topicRelation).toBe("new_topic");
  });

  test("projects a deterministic card with capped fields", () => {
    const input: AgentStateCardBuildInput = {
      currentRequest: "还是不对，街道的方向是不是反了",
      now: FixedNow,
      history: [
        historyTurn({ request: "画个svg动态图，鸭子快跑" }),
        historyTurn({
          request: "处理为动态gif给我行不行？",
          tools: [{ name: "ShellCommandTool", status: "success" }],
        }),
        historyTurn({
          request: "继续优化啊，怎么环境不动啊",
          tools: [
            { name: "ArtifactReadTool", status: "success" },
            { name: "ShellCommandTool", status: "failure" },
          ],
          artifacts: ["file:.tmp/pelican-cycle.gif", "file:.tmp/pelican-cycle-fresh.svg"],
        }),
      ],
    };

    const first = buildAgentStateCard(input);
    const second = buildAgentStateCard(input);

    expect(first).toEqual(second);
    expect(first.version).toBe(AgentStateCardSchemaVersion);
    expect(first.turnIndex).toBe(3);
    expect(first.prevRequests).toHaveLength(3);
    expect(first.artifacts).toEqual(["file:.tmp/pelican-cycle.gif", "file:.tmp/pelican-cycle-fresh.svg"]);
    expect(first.lastTools.map((tool) => tool.name)).toEqual(["ShellCommandTool", "ArtifactReadTool"]);
    expect(first.failedTools).toEqual([{ name: "ShellCommandTool", status: "failure" }]);
    expect(first.historyLayer).toBe(AgentStateCardHistoryLayers.Fine);
    expect(first.scene).toEqual({ time: "2026-10-04T09:12:00+08:00[Asia/Shanghai]", timeZone: "Asia/Shanghai" });
  });

  test("projects the explicit coarse compaction layer when fine history is absent", () => {
    const card = buildAgentStateCard({
      currentRequest: "继续",
      now: FixedNow,
      history: [],
      compaction: {
        depth: 2,
        summary: "用户要求生成鹈鹕骑行动图并反复调整环境运动",
        toolIndex: [{ name: "ShellCommandTool", status: "success" }],
        artifacts: ["file:.tmp/pelican-cycle.gif"],
      },
    });

    expect(card.historyLayer).toBe(AgentStateCardHistoryLayers.Coarse);
    expect(card.compactionDepth).toBe(2);
    expect(card.prevRequests).toEqual(["用户要求生成鹈鹕骑行动图并反复调整环境运动"]);
    expect(card.lastTools).toEqual([{ name: "ShellCommandTool", status: "success" }]);
    expect(card.artifacts).toEqual(["file:.tmp/pelican-cycle.gif"]);
  });

  test("honours an explicit turn index", () => {
    const card = buildAgentStateCard({
      currentRequest: "帮我读取 e:/senera/README.md",
      now: FixedNow,
      history: [],
      turnIndex: 7,
    });

    expect(card.turnIndex).toBe(7);
  });
});
