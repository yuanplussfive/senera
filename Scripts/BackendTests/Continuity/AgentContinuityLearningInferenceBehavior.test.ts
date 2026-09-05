import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { AgentContinuityLearningInferenceRuntime } from "../../../Source/AgentSystem/Continuity/AgentContinuityLearningInferenceRuntime.js";
import { AgentContinuityLearningPromptBundleRegistry } from "../../../Source/AgentSystem/Continuity/AgentContinuityLearningPromptBundle.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import type { ResolvedAgentContinuityLearningConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  AgentContinuityPromptBudgetDefaults,
  AgentContinuityRecallRankingDefaults,
  AgentContinuitySemanticRecallDefaults,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { recordActiveAgentModelUsage } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";

describe("continuity learning inference cache", () => {
  test("reuses an exact host-accepted result without another model call", async () => {
    const fixture = createFixture("senera-learning-inference-reuse");
    try {
      insertEpisode(fixture.kernel, "senera://memory-episode/cache-reuse");
      const runtime = new AgentContinuityLearningInferenceRuntime({
        store: fixture.store,
        identity: { workspaceId: "workspace-test", accountId: "account-test", runtimeId: "runtime-test" },
      });
      const promptInput = factPromptInput();
      const invoke = vi.fn(async (_input, options) => {
        expect(options.cache.retention).toBe("long");
        expect(options.cache.scope).toMatch(/^continuity-/);
        expect(options.stableSystemPrompt).toContain("Registered relation catalog");
        return {
          items: [{ kind: "fact" as const, text: "用户住在上海。" }],
          agenda: [],
          needsRulePass: false,
        };
      });
      const configuration = learningConfiguration();
      const first = await runtime.extractFacts({
        promptInput,
        configuration,
        signal: new AbortController().signal,
        nowMs: 1_000,
        invoke,
      });
      expect(first.cacheHit).toBe(false);
      runtime.record(first, "senera://memory-episode/cache-reuse", 1, 1_001);

      const second = await runtime.extractFacts({
        promptInput,
        configuration,
        signal: new AbortController().signal,
        nowMs: 1_002,
        invoke,
      });

      expect(second.cacheHit).toBe(true);
      expect(second.output).toEqual(first.output);
      expect(invoke).toHaveBeenCalledOnce();
    } finally {
      fixture.close();
    }
  });

  test("freezes representative examples for the lifetime of a prompt registry", () => {
    const fixture = createFixture("senera-learning-bundle-freeze");
    try {
      insertEpisode(fixture.kernel, "senera://memory-episode/example-a");
      insertEpisode(fixture.kernel, "senera://memory-episode/example-b");
      const emptyRegistry = new AgentContinuityLearningPromptBundleRegistry(fixture.store);
      const emptyBundle = emptyRegistry.get("facts", 12_000);
      recordInference(fixture.store, emptyBundle.contractRevision, "example-a", "fact-a", 1_000);

      expect(emptyRegistry.get("facts", 12_000)).toBe(emptyBundle);
      expect(emptyBundle.demonstrationKeys).toEqual([]);

      const populatedRegistry = new AgentContinuityLearningPromptBundleRegistry(fixture.store);
      const populatedBundle = populatedRegistry.get("facts", 12_000);
      expect(populatedBundle.demonstrationKeys).toEqual(["fact-a"]);
      expect(populatedBundle.systemPrompt).toContain("Verified host-accepted examples");

      recordInference(fixture.store, populatedBundle.contractRevision, "example-b", "fact-b", 1_001);
      expect(populatedRegistry.get("facts", 12_000)).toBe(populatedBundle);
      expect(populatedBundle.demonstrationKeys).toEqual(["fact-a"]);
    } finally {
      fixture.close();
    }
  });

  test("deletes cached inferences with their physical source episode", () => {
    const fixture = createFixture("senera-learning-inference-cascade");
    try {
      insertEpisode(fixture.kernel, "senera://memory-episode/cache-delete");
      const registry = new AgentContinuityLearningPromptBundleRegistry(fixture.store);
      const bundle = registry.get("facts", 12_000);
      recordInference(fixture.store, bundle.contractRevision, "cache-delete", "delete-key", 1_000);
      expect(fixture.store.readLearningInference("delete-key", 1_001)).toBeDefined();

      fixture.kernel.connection
        .prepare("DELETE FROM memory_episodes WHERE uri = ?")
        .run("senera://memory-episode/cache-delete");

      expect(fixture.store.readLearningInference("delete-key", 1_002)).toBeUndefined();
    } finally {
      fixture.close();
    }
  });

  test("settles the shared budget with provider-reported usage", async () => {
    const fixture = createFixture("senera-learning-inference-usage");
    try {
      insertEpisode(fixture.kernel, "senera://memory-episode/usage");
      const settle = vi.fn();
      const budget = {
        reserve: vi.fn(() => ({
          allowed: true as const,
          reservation: {
            id: "reservation-usage",
            scope: "workspace-test",
            lane: "continuity",
            sourceId: "continuity.learning",
            requestId: "usage-key",
            estimatedInputTokens: 500,
            estimatedOutputTokens: 0,
            reservedAtMs: 1_000,
          },
        })),
        settle,
        acquire: vi.fn(),
      };
      const runtime = new AgentContinuityLearningInferenceRuntime({
        store: fixture.store,
        identity: { workspaceId: "workspace-test", accountId: "account-test", runtimeId: "runtime-test" },
        inferenceBudget: budget,
      });
      await runtime.extractFacts({
        promptInput: factPromptInput(),
        configuration: learningConfiguration(),
        signal: new AbortController().signal,
        nowMs: 1_000,
        invoke: async () => {
          recordActiveAgentModelUsage({
            stage: "facts",
            usage: { source: "provider_reported", inputTokens: 11, outputTokens: 7, totalTokens: 18 },
          });
          return {
            items: [{ kind: "fact" as const, text: "用户住在上海。" }],
            agenda: [],
            needsRulePass: false,
          };
        },
      });
      expect(settle).toHaveBeenCalledWith({
        reservationId: "reservation-usage",
        actualInputTokens: 11,
        actualOutputTokens: 7,
      });
    } finally {
      fixture.close();
    }
  });
});

function createFixture(prefix: string) {
  const workspace = createTemporaryDirectory(prefix);
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const store = new AgentContinuitySqliteStore(kernel);
  return {
    kernel,
    store,
    close: () => {
      kernel.close();
      removeDirectory(workspace);
    },
  };
}

function recordInference(
  store: AgentContinuitySqliteStore,
  contractRevision: string,
  episodeSuffix: string,
  inferenceKey: string,
  observedAtMs: number,
): void {
  store.recordLearningInference({
    inferenceKey,
    stage: "facts",
    contractRevision,
    bundleRevision: "bundle-test",
    providerId: "provider-test",
    model: "model-test",
    inputJson: JSON.stringify(factPromptInput()),
    outputJson: JSON.stringify({
      items: [{ kind: "fact", text: `事实 ${episodeSuffix}` }],
      agenda: [],
      needsRulePass: false,
    }),
    featureKeys: ["item:fact"],
    acceptedItemCount: 1,
    sourceEpisodeUri: `senera://memory-episode/${episodeSuffix}`,
    observedAtMs,
  });
}

function factPromptInput() {
  return {
    timeZone: "Asia/Shanghai",
    completedAt: "2026-08-31T12:00:00+08:00",
    evidence: [{ kind: "user" as const, text: "我住在上海。", createdAt: "2026-08-31T12:00:00+08:00" }],
    turnContext: [],
    referents: [],
    profileCatalog: {},
    agentProfileCatalog: {},
    agendaCatalog: [],
  };
}

function learningConfiguration(): ResolvedAgentContinuityLearningConfig {
  const provider = createModelProvider({ ToolPlanningMode: "native", Capabilities: { ToolCalling: true } });
  return {
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
  };
}

function insertEpisode(kernel: AgentSqliteDatabaseKernel, uri: string): void {
  const suffix = uri.slice(uri.lastIndexOf("/") + 1);
  kernel.connection
    .prepare(
      `INSERT INTO memory_episodes (
        id, uri, session_id, request_id, status, raw_user_text, standalone_request,
        context_mode, context_basis, topic, summary, started_at, completed_at, updated_at,
        started_at_ms, completed_at_ms, updated_at_ms, time_zone, local_date, local_hour, metadata_json
      ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `episode-${suffix}`,
      uri,
      `session-${suffix}`,
      `request-${suffix}`,
      "我住在上海。",
      "我住在上海。",
      "current",
      "current turn",
      "memory",
      "用户说明居住地点。",
      "2026-08-31T04:00:00.000Z",
      "2026-08-31T04:00:01.000Z",
      "2026-08-31T04:00:01.000Z",
      1_000,
      1_001,
      1_001,
      "Asia/Shanghai",
      "2026-08-31",
      "12",
      "{}",
    );
}
