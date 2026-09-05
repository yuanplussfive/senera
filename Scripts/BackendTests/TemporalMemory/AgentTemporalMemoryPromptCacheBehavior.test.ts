import { describe, expect, test } from "vitest";
import { createAgentTemporalMemoryPromptCache } from "../../../Source/AgentSystem/TemporalMemory/AgentTemporalMemoryPromptCache.js";

describe("temporal memory prompt cache identity", () => {
  test("reuses one immutable contract across volatile temporal inputs", () => {
    const first = createAgentTemporalMemoryPromptCache({
      scopeKey: "temporal_scope_a",
      phase: "conversation-boundary",
      model: "model-a",
      systemPrompt: "stable boundary contract",
      contract: "ClassifyConversationBoundary",
    });
    const second = createAgentTemporalMemoryPromptCache({
      scopeKey: "temporal_scope_a",
      phase: "conversation-boundary",
      model: "model-a",
      systemPrompt: "stable boundary contract",
      contract: "ClassifyConversationBoundary",
    });

    expect(second).toEqual(first);
    expect(first.retention).toBe("long");
    expect(first.scope).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("isolates identities, phases, models, and static contracts", () => {
    const baseline = createAgentTemporalMemoryPromptCache({
      scopeKey: "temporal_scope_a",
      phase: "conversation-boundary",
      model: "model-a",
      systemPrompt: "stable contract",
      contract: "Boundary",
    });
    const variants = [
      createAgentTemporalMemoryPromptCache({
        scopeKey: "temporal_scope_b",
        phase: "conversation-boundary",
        model: "model-a",
        systemPrompt: "stable contract",
        contract: "Boundary",
      }),
      createAgentTemporalMemoryPromptCache({
        scopeKey: "temporal_scope_a",
        phase: "digest-summary",
        model: "model-a",
        systemPrompt: "stable contract",
        contract: "Boundary",
      }),
      createAgentTemporalMemoryPromptCache({
        scopeKey: "temporal_scope_a",
        phase: "conversation-boundary",
        model: "model-b",
        systemPrompt: "stable contract",
        contract: "Boundary",
      }),
      createAgentTemporalMemoryPromptCache({
        scopeKey: "temporal_scope_a",
        phase: "conversation-boundary",
        model: "model-a",
        systemPrompt: "changed contract",
        contract: "Boundary",
      }),
    ];

    expect(new Set(variants.map(({ scope }) => scope)).size).toBe(variants.length);
    expect(variants.every(({ scope }) => scope !== baseline.scope)).toBe(true);
  });
});
