import { describe, expect, test } from "vitest";
import { applyAgentContinuityPromptBudget } from "../../../Source/AgentSystem/Continuity/AgentContinuityPromptBudget.js";
import {
  EmptyAgentContinuityMemoryPromptContext,
  type AgentContinuityEventCandidate,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryTypes.js";
import {
  renderAgentContinuityPromptWire,
  renderAgentLiveStateWire,
} from "../../../Source/AgentSystem/Prompt/AgentPromptContextWireRenderer.js";
import { EmptyAgentWorkflowPromptContext } from "../../../Source/AgentSystem/Prompt/AgentWorkflowPromptContext.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";

const tokenizer = new AgentModelTokenEstimator({ model: "gpt-4o" });
const estimateTokens = (text: string) => tokenizer.estimate(text).tokenCount;
const entry = (id: string, summary: string): AgentContinuityEventCandidate => ({
  id,
  uri: `memos:${id}`,
  revision: id,
  summary,
  type: "fact",
  occurredAt: "2026-10-09T00:00:00Z",
  score: 0.9,
  matchedBy: ["memos"],
});

describe("complete serialized recall token budgets", () => {
  test("admits more than old entry caps while counting references and full wire overhead", () => {
    const events = Array.from({ length: 32 }, (_, index) => entry(String(index), `记录${index}：已经确认的信息。`));
    const budgeted = applyAgentContinuityPromptBudget(
      { digests: [], events, historicalTokenBudget: { maxTokens: 100000, estimateTokens } },
      { MaxTokens: 16384 },
    );
    expect(budgeted.events).toHaveLength(32);
    const context = {
      ...EmptyAgentContinuityMemoryPromptContext,
      enabled: true,
      eventCandidates: budgeted.events,
      periodDigests: budgeted.digests,
    };
    const wire = renderAgentContinuityPromptWire(context, { estimateTokens });
    expect(budgeted.selection.usedTokens).toBe(estimateTokens(wire.text));
    expect(budgeted.selection.maxTokens).toBe(16384);
    expect(
      renderAgentLiveStateWire({ continuity: context, workflow: EmptyAgentWorkflowPromptContext }, { estimateTokens })
        .text,
    ).toBe(wire.text);
  });

  test("fits smaller model headroom, skips oversized records whole, and marks only selected coverage", () => {
    const events = [
      entry("oversized", "不可截断的事实。".repeat(9000)),
      entry("small", "用户喜欢牛肉。"),
      entry("other", "用户喝咖啡。"),
    ];
    const one = applyAgentContinuityPromptBudget(
      { digests: [], events: [events[1]!], historicalTokenBudget: { maxTokens: 16384, estimateTokens } },
      { MaxTokens: 16384 },
    );
    const budgeted = applyAgentContinuityPromptBudget(
      { digests: [], events, historicalTokenBudget: { maxTokens: one.selection.usedTokens, estimateTokens } },
      { MaxTokens: 16384 },
    );
    expect(budgeted.events).toHaveLength(1);
    expect(budgeted.events[0]?.id).not.toBe("oversized");
    expect(budgeted.selection.usedTokens).toBeLessThanOrEqual(one.selection.usedTokens);
    const empty = applyAgentContinuityPromptBudget(
      { digests: [], events, historicalTokenBudget: { maxTokens: 0, estimateTokens } },
      { MaxTokens: 16384 },
    );
    expect(empty.events).toHaveLength(0);
    expect(empty.selection.usedTokens).toBe(0);
  });
});
