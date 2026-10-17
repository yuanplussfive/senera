import path from "node:path";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentContinuityMemoryService } from "./AgentContinuityMemoryService.js";
import { AgentContinuitySqliteStore } from "./AgentContinuitySqliteStore.js";
import { AgentMemoryDatabaseContract } from "../Memory/AgentMemorySqlSchema.js";
import { AgentMemoryService } from "../Memory/AgentMemoryService.js";
import { SqliteAgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentExecutionLedgerService } from "../Goals/AgentExecutionLedgerService.js";
import { AgentExecutionLedgerSqliteStore } from "../Goals/AgentExecutionLedgerSqliteStore.js";
import { AgentTodoService } from "../Todos/AgentTodoService.js";
import { AgentTodoSqliteStore } from "../Todos/AgentTodoSqliteStore.js";
import type { AgentTodoPolicy } from "../Todos/AgentTodoTypes.js";
import { resolveContinuityLearningConfig } from "../AgentDefaults.js";
import { AgentContinuityLifecycleCoordinator, type AgentContinuityLifecyclePort } from "./AgentContinuityLifecycle.js";
import type { AgentEmbeddingClient as AgentContinuitySemanticEmbeddingClient } from "../Vector/AgentEmbeddingContract.js";

import { AgentContinuityIdentityStore, type AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";
import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";
import { AgentBackgroundLearningRequestLedger } from "../Memory/AgentBackgroundLearningRequestLedger.js";
import { createAgentContinuityRecallService, type AgentContinuityRecallService } from "./AgentContinuityToolRuntime.js";
import { AgentContinuityMemOSRuntime } from "./AgentContinuityMemOSRuntime.js";

export interface AgentContinuityRuntime {
  readonly database: AgentSqliteDatabaseKernel;
  readonly learningRequests: AgentBackgroundLearningRequestLedger;
  readonly store: AgentContinuitySqliteStore;
  readonly memory: AgentMemoryService;
  readonly promptContext: AgentContinuityMemoryService;
  readonly identity: AgentContinuityIdentityContext;
  readonly executionLedger: AgentExecutionLedgerService;
  readonly todos: AgentTodoService;
  readonly lifecycle: AgentContinuityLifecyclePort;
  readonly recall: AgentContinuityRecallService;
  readonly memos: AgentContinuityMemOSRuntime;
  close(): Promise<void>;
}

export function createAgentContinuityRuntime(input: {
  /** Physical source and continuity ledger used for provenance and deletion. */
  readonly databasePath: string;
  /** MemOS graph database used for semantic memory and routing scenarios. */
  readonly memosDatabasePath: string;
  readonly identityPath: string;
  readonly workspaceId?: string;
  readonly upgradeSession: AgentUpgradeSession;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly todoPolicy: AgentTodoPolicy;
  /** Shared embedding client used by the MemOS memory authority. */
  readonly embeddingClient: AgentContinuitySemanticEmbeddingClient;
  readonly embeddingModel: () => string;
  readonly identityDisplayValues?: () => AgentIdentityDisplayValues;
  readonly logger?: AgentLogger;
  /** Dedicated projection stream for semantic-learning queue and promotion work. */
  readonly learningLogger?: AgentLogger;
}): AgentContinuityRuntime {
  assertDistinctDatabasePaths(input.databasePath, input.memosDatabasePath);
  const database = new AgentSqliteDatabaseKernel({
    databasePath: input.databasePath,
    contract: AgentMemoryDatabaseContract,
    upgradeSession: input.upgradeSession,
  });
  let memosForCleanup: AgentContinuityMemOSRuntime | undefined;
  try {
    const identityStore = new AgentContinuityIdentityStore(input.identityPath, input.workspaceId);
    const baseIdentity = identityStore.context();
    const learningRequests = new AgentBackgroundLearningRequestLedger(database, input.learningLogger);
    const sourceRepository = new SqliteAgentMemorySourceRepository(database);
    const memos = new AgentContinuityMemOSRuntime({
      databasePath: input.memosDatabasePath,
      namespace: baseIdentity.workspaceId,
      embeddingClient: input.embeddingClient,
      embeddingModel: input.embeddingModel,
      autoLinkThreshold: resolveContinuityLearningConfig(input.configSnapshot()).MemOS.AutoLinkThreshold,
      recallDedupeConfig: () => {
        const config = resolveContinuityLearningConfig(input.configSnapshot()).MemOS;
        return { threshold: config.RecallDedupeThreshold, maxPairs: config.RecallDedupeMaxPairs };
      },
      sourceRepository,
      learningRequests,
      semanticModelProvider: () => resolveContinuityLearningConfig(input.configSnapshot()).Client.ModelProvider,
      semanticPolicy: () => {
        const continuity = resolveContinuityLearningConfig(input.configSnapshot());
        return {
          enabled: continuity.Enabled,
          maxAttempts: continuity.Runtime.MaxAttempts,
          retryBaseMs: continuity.Runtime.RetryBaseDelaySeconds * 1_000,
          retryMaxDelayMs: continuity.Runtime.RetryMaxDelaySeconds * 1_000,
          maxJobsPerDrain: continuity.Runtime.MaxJobsPerDrain,
        };
      },
      semanticConfig: () => {
        const memosConfig = resolveContinuityLearningConfig(input.configSnapshot()).MemOS;
        return {
          fragmentHistoryTurns: memosConfig.FragmentHistoryTurns,
          knowledgeCandidateLimit: memosConfig.KnowledgeCandidateLimit,
          assistantPreviewTokens: memosConfig.AssistantPreviewTokens,
          digestInputTokenBudget: memosConfig.DigestInputTokenBudget,
          digestSummaryTokenLimit: memosConfig.DigestSummaryTokenLimit,
        };
      },
      semanticScopeKey: baseIdentity.workspaceId,
      logger: input.logger,
      learningLogger: input.learningLogger,
    });
    memosForCleanup = memos;
    const store = new AgentContinuitySqliteStore(database);
    const identity = identityStore.context();
    const recall = createAgentContinuityRecallService({
      memos,
      configSnapshot: input.configSnapshot,
    });
    const executionLedger = new AgentExecutionLedgerService({
      store: new AgentExecutionLedgerSqliteStore(database),
    });
    const todos = new AgentTodoService({ store: new AgentTodoSqliteStore(database), policy: input.todoPolicy });
    const promptContext = new AgentContinuityMemoryService({
      store,
      recallConfig: () => resolveContinuityLearningConfig(input.configSnapshot()).Recall,
      memos,
      logger: input.logger,
    });
    const memory = new AgentMemoryService({
      sourceRepository,
      completedTurnSinks: [memos],
      completedTurnSinkFailure: ({ error }) =>
        input.learningLogger?.warn("memory.completed_turn_sink.failed", {
          error: errorMessage(error),
        }),
      deletionSinks: [store, promptContext, memos],
    });
    const lifecycle = new AgentContinuityLifecycleCoordinator({
      memory: {
        close: memory.close.bind(memory),
        flushSemanticLearning: () => memos.flush({ surfaceFailures: false }),
      },
      promptContext,
    });
    return {
      database,
      learningRequests,
      store,
      memory,
      promptContext,
      identity,
      executionLedger,
      todos,
      lifecycle,
      recall,
      memos,
      close: async () => {
        try {
          await lifecycle.close();
          await memos.close();
        } finally {
          database.close();
        }
      },
    };
  } catch (error) {
    if (memosForCleanup) {
      void memosForCleanup.close().catch((closeError) => {
        input.logger?.error("memory.memos.startup_close_failed", {
          message: errorMessage(closeError),
        });
      });
    }
    database.close();
    throw error;
  }
}

function assertDistinctDatabasePaths(databasePath: string, memosDatabasePath: string): void {
  const physicalPath = path.resolve(databasePath);
  const semanticPath = path.resolve(memosDatabasePath);
  if (physicalPath === semanticPath) {
    throw new Error("Continuity physical and MemOS databases must use distinct paths.");
  }
}
