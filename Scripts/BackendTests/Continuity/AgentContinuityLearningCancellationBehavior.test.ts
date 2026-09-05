import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { AgentAgendaLearningBridge } from "../../../Source/AgentSystem/Agenda/AgentAgendaLearningBridge.js";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentContinuityLearningRuntime } from "../../../Source/AgentSystem/Continuity/AgentContinuityLearningRuntime.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryService } from "../../../Source/AgentSystem/Memory/AgentMemoryService.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { SqliteAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySqliteSourceRepository.js";
import { AgentResidentProfileService } from "../../../Source/AgentSystem/Profile/AgentResidentProfileService.js";
import { AgentResidentProfileSqliteStore } from "../../../Source/AgentSystem/Profile/AgentResidentProfileSqliteStore.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  createModelProvider,
  createModelProviderEndpoint,
  createTemporaryDirectory,
  removeDirectory,
} from "../Support/AgentTestFixtures.js";

describe("continuity learning cancellation", () => {
  test("aborts an in-flight extraction when its session is deleted", async () => {
    const workspace = createTemporaryDirectory("senera-continuity-learning-cancel");
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const sources = new SqliteAgentMemorySourceRepository(kernel);
    const store = new AgentContinuitySqliteStore(kernel);
    const profile = new AgentResidentProfileService({ store: new AgentResidentProfileSqliteStore(kernel) });
    const agenda = new AgentAgendaLearningBridge(new AgentAgendaService({ store: new AgentAgendaSqliteStore(kernel) }));
    let signalExtractionStarted!: () => void;
    const extractionStarted = new Promise<void>((resolve) => {
      signalExtractionStarted = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const extractFacts = vi.fn(
      (_input: unknown, options: { readonly signal?: AbortSignal } = {}): Promise<never> =>
        new Promise((_resolve, reject) => {
          observedSignal = options.signal;
          if (!observedSignal) {
            reject(new Error("Continuity extraction did not receive a cancellation signal."));
            return;
          }
          signalExtractionStarted();
          observedSignal.addEventListener("abort", () => reject(observedSignal?.reason), { once: true });
        }),
    );
    const learning = new AgentContinuityLearningRuntime({
      sourceRepository: sources,
      store,
      identity: {
        workspaceId: "workspace-test",
        userId: "user-test",
        runtimeId: "runtime-test",
      },
      configSnapshot: testConfig,
      residentProfile: profile,
      agendaLearning: agenda,
      agendaTimeZone: () => "Asia/Shanghai",
      rulesSnapshot: () => ({ rules: [], signals: [] }),
      modelClientFactory: () => ({
        extractFacts,
        extractRules: async () => ({ items: [] }),
      }),
      runtimePolicy: () => ({ maxAttempts: 3, retryBaseMs: 1_000, retryMaxDelayMs: 60_000, maxJobsPerDrain: 8 }),
    });
    const memory = new AgentMemoryService({
      sourceRepository: sources,
      continuityLearning: learning,
      deletionSinks: [learning],
    });

    try {
      learning.start();
      memory.recordCompletedTurn({
        sessionId: "session-delete",
        requestId: "request-delete",
        startedAt: "2026-08-31T04:00:00.000Z",
        completedAt: "2026-08-31T04:00:01.000Z",
        userEntry: {
          id: "entry-user",
          requestId: "request-delete",
          timestamp: "2026-08-31T04:00:00.000Z",
          kind: "user.message",
          content: "记住这件事。",
        },
        assistantEntry: {
          id: "entry-assistant",
          requestId: "request-delete",
          timestamp: "2026-08-31T04:00:01.000Z",
          kind: "assistant.decision",
          xml: "<agent_result><final_answer>好。</final_answer></agent_result>",
        },
        terminal: { kind: "FinalAnswer", content: "好。" },
        executedTools: [],
      });
      await extractionStarted;

      memory.deleteSession("session-delete");

      expect(observedSignal?.aborted).toBe(true);
      await learning.stop();
      expect(extractFacts).toHaveBeenCalledOnce();
      expect(store.listDueLearningJobs(Number.MAX_SAFE_INTEGER, 10)).toEqual([]);
    } finally {
      memory.deleteSession("session-delete");
      await learning.stop();
      await memory.close();
      kernel.close();
      removeDirectory(workspace);
    }
  });
});

function testConfig(): AgentSystemConfig {
  const provider = createModelProvider();
  return {
    DefaultModelProviderId: provider.Id,
    ModelProviderEndpoints: [createModelProviderEndpoint()],
    ModelProviders: [provider],
    ContinuityLearning: {
      Enabled: true,
      Recall: { Semantic: { Enabled: false } },
    },
  };
}
