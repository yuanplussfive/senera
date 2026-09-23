import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import type { AgentContinuityObservation } from "../../../Source/AgentSystem/Continuity/AgentContinuityDomain.js";
import { AgentContinuityMemoryService } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryService.js";
import {
  AgentContinuityPromptBudgetDefaults,
  AgentContinuityRecallRankingDefaults,
  AgentContinuitySemanticRecallDefaults,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { AgentContinuitySemanticRecall } from "../../../Source/AgentSystem/Continuity/AgentContinuitySemanticRecall.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { testContinuityIdentity } from "./AgentContinuityTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity memory service cancellation", () => {
  test("propagates caller cancellation through semantic recall instead of treating it as lexical fallback", async () => {
    const workspaceRoot = createWorkspace();
    const store = new AgentContinuitySqliteStore(path.join(workspaceRoot, ".senera", "data", "memory.sqlite"));
    try {
      const remembered = {
        id: "coffee",
        uri: "senera://continuity-learning/coffee",
        kind: "learning.record",
        summary: "The user prefers unsweetened coffee.",
        payload: { kind: "fact", until: "permanent" },
        sourceRefs: ["senera://memory-source/coffee"],
        watermark: "coffee-v1",
        scope: { kind: "workspace" as const, id: workspaceRoot },
        authority: "user_explicit" as const,
        confidence: 1,
        occurredAt: "2026-08-23T01:00:00.000Z",
        observedAt: "2026-08-23T01:00:01.000Z",
        createdAtMs: Date.parse("2026-08-23T01:00:01.000Z"),
      } satisfies AgentContinuityObservation;
      store.recordObservation(remembered);

      let queryStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        queryStarted = resolve;
      });
      const semanticRecall = new AgentContinuitySemanticRecall({
        store,
        client: {
          embed: async (request) => ({
            model: "test-embedding",
            vectors: request.input.map(() => [1, 0]),
          }),
        },
        model: () => "test-embedding",
        scoreFloor: () => 0,
      });
      await semanticRecall.embedObservations([remembered]);
      semanticRecall.setClient({
        embed: async (request) => {
          if (request.role === "query") {
            queryStarted?.();
            await new Promise<void>((_resolve, reject) => {
              const rejectWhenAborted = () => reject(request.signal?.reason);
              request.signal?.addEventListener("abort", rejectWhenAborted, { once: true });
            });
          }
          return { model: "test-embedding", vectors: request.input.map(() => [1, 0]) };
        },
      });
      const controller = new AbortController();
      const service = new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
        semanticRecall,
        recallConfig: () => ({
          TurnValueClassifier: {
            Enabled: false,
            ConfidenceThreshold: 0.82,
            MinimumExamplesPerLabel: 3,
            MaxTrainingEntries: 4096,
          },
          Prefetch: { Enabled: false, CacheTtlSeconds: 300 },
          PromptBudget: AgentContinuityPromptBudgetDefaults,
          Ranking: AgentContinuityRecallRankingDefaults,
          Semantic: { ...AgentContinuitySemanticRecallDefaults, Enabled: true },
        }),
      });

      const pending = service.promptContext({
        userInput: "Please suggest a beverage for today.",
        sessionId: "session-1",
        signal: controller.signal,
      });
      await started;
      controller.abort(new AgentCancellationError("Continuity recall cancelled."));

      await expect(pending).rejects.toMatchObject({
        name: "AgentCancellationError",
        message: "Continuity recall cancelled.",
      });
    } finally {
      store.close();
    }
  });
});

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-continuity-memory-cancellation");
  workspaces.add(workspace);
  return workspace;
}
