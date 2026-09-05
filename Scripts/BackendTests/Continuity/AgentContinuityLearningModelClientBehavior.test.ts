import { describe, expect, test, vi } from "vitest";
import { AgentContinuityLearningModelClient } from "../../../Source/AgentSystem/Continuity/AgentContinuityLearningModelClient.js";
import {
  AgentContinuityPromptBudgetDefaults,
  AgentContinuityRecallRankingDefaults,
  AgentContinuitySemanticRecallDefaults,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { AgentContinuityExtractionFailure } from "../../../Source/AgentSystem/Continuity/AgentContinuityExtractionFailure.js";
import { AgentRequiredModelToolCallError } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelFailureMapper.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import type { AgentStablePromptInvocationOptions } from "../../../Source/AgentSystem/ModelEndpoints/AgentLanguageModel.js";

describe("continuity learning model client", () => {
  test("records only the configured native failure without switching protocols", async () => {
    const bamlFacts = vi.fn(async () => ({
      items: [{ kind: "fact", text: "不应被调用" }],
      agenda: [],
      needsRulePass: false,
    }));
    const client = createClient({
      nativeFact: async () => {
        throw new AgentRequiredModelToolCallError("ContinuityCapture", []);
      },
      bamlFacts,
    });

    await expect(client.extractFacts(factPromptInput(), invocationOptions())).rejects.toMatchObject({
      stage: "facts",
      attempts: [{ mode: "native", diagnostic: { code: "tool_call_missing" } }],
    } satisfies Partial<AgentContinuityExtractionFailure>);
    expect(bamlFacts).not.toHaveBeenCalled();
  });

  test("uses BAML only when the selected model explicitly declares BAML planning", async () => {
    const nativeRules = vi.fn(async () => ({
      items: [{ kind: "always", title: "native", effect: "不应被调用。", until: "permanent" }],
    }));
    const bamlRules = vi.fn(async () => ({
      items: [{ kind: "always", title: "concise", effect: "Keep responses concise.", until: "permanent" }],
    }));
    const client = createClient({
      planningMode: "baml",
      nativeRules,
      bamlRules,
    });

    await expect(client.extractRules(rulePromptInput(), invocationOptions())).resolves.toEqual({
      items: [{ kind: "always", title: "concise", effect: "Keep responses concise.", until: "permanent" }],
    });
    expect(bamlRules).toHaveBeenCalledOnce();
    expect(nativeRules).not.toHaveBeenCalled();
  });

  test("forwards cancellation to the configured extraction transport", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const client = createClient({
      nativeFact: async (_input, options) => {
        observedSignal = options?.signal;
        return { items: [], agenda: [], needsRulePass: false };
      },
    });

    await client.extractFacts(factPromptInput(), invocationOptions(controller.signal));

    expect(observedSignal).toBe(controller.signal);
  });
});

function createClient(overrides: {
  planningMode?: "native" | "baml";
  nativeFact?: (_input: unknown, options: AgentStablePromptInvocationOptions) => Promise<unknown>;
  nativeRules?: (_input: unknown, options: AgentStablePromptInvocationOptions) => Promise<unknown>;
  bamlFacts?: (_input: unknown, options: AgentStablePromptInvocationOptions) => Promise<unknown>;
  bamlRules?: (_input: unknown, options: AgentStablePromptInvocationOptions) => Promise<unknown>;
}): AgentContinuityLearningModelClient {
  const provider = createModelProvider({
    Endpoint: "Responses",
    ToolPlanningMode: overrides.planningMode ?? "native",
    Capabilities: { ToolCalling: true },
  });
  return new AgentContinuityLearningModelClient({
    configuration: {
      Enabled: true,
      UsesDefaultModel: false,
      Client: {
        ModelProvider: provider,
        ModelProviderId: provider.Id,
        BaseUrl: provider.BaseUrl,
        ApiKey: provider.ApiKey,
        Model: provider.Model,
        Temperature: provider.Temperature,
        MaxTokens: -1,
      },
      Runtime: { MaxAttempts: 3, RetryBaseDelaySeconds: 1, RetryMaxDelaySeconds: 60, MaxJobsPerDrain: 8 },
      LearningGate: { Enabled: true, DeferredDelaySeconds: 30 },
      LearningContext: {
        ReferentBudgetCharacters: 12_000,
        CatalogBudgetCharacters: 12_000,
        VerifiedExampleBudgetCharacters: 12_000,
      },
      TemporalMemory: { Enabled: true },
      Recall: {
        TurnValueClassifier: {
          Enabled: true,
          ConfidenceThreshold: 0.82,
          MinimumExamplesPerLabel: 3,
          MaxTrainingEntries: 4096,
        },
        Prefetch: { Enabled: true, CacheTtlSeconds: 300 },
        PromptBudget: AgentContinuityPromptBudgetDefaults,
        Ranking: AgentContinuityRecallRankingDefaults,
        Semantic: AgentContinuitySemanticRecallDefaults,
      },
    },
    nativeFactClient: {
      extract: overrides.nativeFact ?? (async () => ({ items: [], agenda: [], needsRulePass: false })),
    },
    nativeRuleClient: {
      extract:
        overrides.nativeRules ??
        (async () => ({ items: [{ kind: "always", title: "default", effect: "Keep context.", until: "session" }] })),
    },
    bamlClient: {
      extractContinuityFacts: overrides.bamlFacts ?? (async () => ({ items: [], agenda: [], needsRulePass: false })),
      extractContinuityRules:
        overrides.bamlRules ??
        (async () => ({ items: [{ kind: "always", title: "default", effect: "Keep context.", until: "session" }] })),
    },
  });
}

function factPromptInput() {
  return {
    timeZone: "Asia/Shanghai",
    completedAt: "2026-08-22T00:00:01+08:00",
    profileCatalog: {},
    agentProfileCatalog: {},
    agendaCatalog: [],
    evidence: [{ kind: "user" as const, text: "Remember this.", createdAt: "2026-08-22T00:00:00+08:00" }],
    turnContext: [],
    referents: [],
  };
}

function invocationOptions(signal?: AbortSignal): AgentStablePromptInvocationOptions {
  return {
    signal,
    stableSystemPrompt: "stable continuity contract",
    cache: { scope: "continuity-test", retention: "long" },
  };
}

function rulePromptInput() {
  return {
    ...factPromptInput(),
    facts: ["用户要求在完成运动后提醒查看天气。"],
    stateCatalog: {},
    ruleCatalog: {},
  };
}
