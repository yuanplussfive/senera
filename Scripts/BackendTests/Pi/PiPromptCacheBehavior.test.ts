import { describe, expect, test } from "vitest";
import { deriveAgentModelCacheOptions } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelCacheScope.js";
import {
  createAgentPiLogicalCacheScope,
  createAgentPiPromptCacheOptions,
} from "../../../Source/AgentSystem/Pi/AgentPiPromptCache.js";
import { createAgentGoalMicroLoopCacheOptions } from "../../../Source/AgentSystem/Agenda/AgentGoalMicroLoopPromptCache.js";

const model = { provider: "provider-a", api: "openai-responses", model: "model-a" } as const;
const otherModel = { ...model, model: "model-b" } as const;
const stablePrefix = {
  systemPrompt: "<stable>resident</stable>",
  tools: [{ name: "ToolSearch", description: "Search", parameters: { type: "object" } }],
} as const;

describe("Pi prompt cache identity", () => {
  test("is deterministic for one stable conversation prefix", () => {
    const first = createAgentPiPromptCacheOptions({
      phase: "native-conversation",
      sessionId: "session-a",
      model,
      stablePrefix,
    });
    const second = createAgentPiPromptCacheOptions({
      phase: "native-conversation",
      sessionId: "session-a",
      model,
      stablePrefix,
    });

    expect(second).toEqual(first);
    expect(first.retention).toBe("long");
    expect(first.scope).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("isolates logical call families while keeping dynamic prompt content in the request", () => {
    const baseline = createAgentPiPromptCacheOptions({
      phase: "native-conversation",
      sessionId: "session-a",
      model,
      stablePrefix,
    });
    const variants = [
      createAgentPiPromptCacheOptions({
        phase: "baml-compaction",
        sessionId: "session-a",
        model,
      }),
      createAgentPiPromptCacheOptions({
        phase: "resident-speech-action-preface",
        sessionId: "session-a",
        model,
      }),
      createAgentPiPromptCacheOptions({
        phase: "native-conversation",
        sessionId: "session-b",
        model,
      }),
      createAgentPiPromptCacheOptions({
        phase: "native-conversation",
        sessionId: "session-a",
        model: otherModel,
      }),
      createAgentPiPromptCacheOptions({
        phase: "resident-speech-final-response",
        sessionId: "session-a",
        model,
      }),
    ];

    expect(new Set(variants.map(({ scope }) => scope)).size).toBe(variants.length);
    expect(variants.every(({ scope }) => scope !== baseline.scope)).toBe(true);
  });

  test("derives independent BAML function scopes from one conversation scope", () => {
    const parent = createAgentPiPromptCacheOptions({
      phase: "baml-planning",
      sessionId: "session-a",
      model,
    });
    const evolve = deriveAgentModelCacheOptions(parent, "EvolveTurn");
    const argumentsCall = deriveAgentModelCacheOptions(parent, "FillPiToolArguments");

    expect(evolve?.retention).toBe(parent.retention);
    expect(evolve?.scope).not.toBe(parent.scope);
    expect(argumentsCall?.scope).not.toBe(evolve?.scope);
  });

  test("rotates only when the stable protocol prefix changes", () => {
    const baseline = createAgentPiPromptCacheOptions({
      phase: "native-conversation",
      sessionId: "session-a",
      model,
      stablePrefix,
    });
    const changedPrefix = createAgentPiPromptCacheOptions({
      phase: "native-conversation",
      sessionId: "session-a",
      model,
      stablePrefix: {
        ...stablePrefix,
        systemPrompt: "<stable>changed</stable>",
      },
    });

    expect(changedPrefix.scope).not.toBe(baseline.scope);
  });

  test("keeps a logical cache scope warm when the physical session rotates", () => {
    const logicalCacheScope = createAgentPiLogicalCacheScope({ sessionId: "session-a", family: "conversation" });
    const beforeRotation = createAgentPiPromptCacheOptions({
      phase: "native-conversation",
      sessionId: "physical-session-a",
      logicalCacheScope,
      model,
      stablePrefix,
    });
    const afterRotation = createAgentPiPromptCacheOptions({
      phase: "native-conversation",
      sessionId: "physical-session-b",
      logicalCacheScope,
      model,
      stablePrefix,
    });

    expect(afterRotation.scope).toBe(beforeRotation.scope);
    expect(
      createAgentPiPromptCacheOptions({
        phase: "native-conversation",
        sessionId: "physical-session-b",
        logicalCacheScope: createAgentPiLogicalCacheScope({ sessionId: "session-b", family: "conversation" }),
        model,
        stablePrefix,
      }).scope,
    ).not.toBe(beforeRotation.scope);
  });

  test("isolates identical model names across providers and APIs", () => {
    const baseline = createAgentPiPromptCacheOptions({
      phase: "native-conversation",
      sessionId: "session-a",
      model,
    });
    const providerVariant = createAgentPiPromptCacheOptions({
      phase: "native-conversation",
      sessionId: "session-a",
      model: { ...model, provider: "provider-b" },
    });
    const apiVariant = createAgentPiPromptCacheOptions({
      phase: "native-conversation",
      sessionId: "session-a",
      model: { ...model, api: "anthropic-messages" },
    });

    expect(new Set([baseline.scope, providerVariant.scope, apiVariant.scope]).size).toBe(3);
  });

  test("keeps Goal state changes out of the stable decision cache identity", () => {
    const baseline = createAgentGoalMicroLoopCacheOptions({
      worldId: "world-a",
      ...model,
      stableSystemPrompt: "<goal-policy>v1</goal-policy>",
    });
    const sameProtocol = createAgentGoalMicroLoopCacheOptions({
      worldId: "world-a",
      ...model,
      stableSystemPrompt: "<goal-policy>v1</goal-policy>",
    });
    const changedProtocol = createAgentGoalMicroLoopCacheOptions({
      worldId: "world-a",
      ...model,
      stableSystemPrompt: "<goal-policy>v2</goal-policy>",
    });
    const otherWorld = createAgentGoalMicroLoopCacheOptions({
      worldId: "world-b",
      ...model,
      stableSystemPrompt: "<goal-policy>v1</goal-policy>",
    });

    expect(sameProtocol.scope).toBe(baseline.scope);
    expect(changedProtocol.scope).not.toBe(baseline.scope);
    expect(otherWorld.scope).not.toBe(baseline.scope);
    expect(baseline.retention).toBe("long");
  });
});
