import { describe, expect, test } from "vitest";
import { EmptyAgentContinuityMemoryPromptContext } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryTypes.js";
import { renderAgentContinuityPromptWire } from "../../../Source/AgentSystem/Prompt/AgentPromptContextWireRenderer.js";
import path from "node:path";
import { AgentPromptRenderer } from "../../../Source/AgentSystem/Prompt/AgentPromptRenderer.js";

describe("native MemOS template context", () => {
  test("renders usable MemOS references without host-only receipts or empty legacy blocks", () => {
    const memory = {
      ...EmptyAgentContinuityMemoryPromptContext,
      enabled: true,
      eventCandidates: [
        {
          id: "internal-id",
          uri: "memos:internal-id",
          revision: "internal-revision",
          type: "preference" as const,
          summary: "用户喜欢咖啡。",
          occurredAt: "2026-08-23T00:00:00Z",
          score: 0.9,
          matchedBy: ["memos"],
        },
      ],
    };
    const wire = renderAgentContinuityPromptWire(memory, { estimateTokens: (text) => text.length });
    const text = new AgentPromptRenderer().renderFileSync(
      path.resolve("System/Prompts/Templates/ContinuityMemory.liquid"),
      {
        ContinuityMemory: memory,
        ContinuityWire: wire.text,
      },
    );
    expect(text).toContain("用户喜欢咖啡。");
    expect(text).toContain("[2026-08-23 08:00] 用户喜欢咖啡。");
    expect(text).toContain("memos:internal-id");
    expect(text).not.toContain("internal-revision");
    expect(text).not.toContain("senera.profile");
    expect(text).not.toContain("memory_selection");
  });
});
